import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, badRequest, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_EXAM_PICK_RULE, EXAM_DIFFICULTIES, EXAM_PICK_RULES, EXAM_SCOPES, MAX_EXAM_QUESTIONS, generateExamPaper, selectSourceItems } from "@/lib/exam";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { consumeAiQuota } from "@/lib/ai-quota";
import { getStudentVisibleExamOwnerIds } from "@/lib/shared-exams";

const logger = createLogger('api:exams');

const createSchema = z.object({
    subjectIds: z.array(z.string().min(1)).min(1).max(50),
    tagNames: z.array(z.string().trim().min(1)).max(50).optional(),
    paperLevelIds: z.array(z.string().min(1)).max(20).optional(),
    scope: z.enum(EXAM_SCOPES),
    count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS),
    pickRule: z.enum(EXAM_PICK_RULES).default(DEFAULT_EXAM_PICK_RULE),
    difficulty: z.enum(EXAM_DIFFICULTIES),
    title: z.string().trim().max(100).optional(),
    language: z.enum(['zh', 'en']).optional(),
});

/**
 * GET /api/exams
 * 当前用户的试卷列表（按创建时间倒序）
 */
export async function GET() {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const visibleOwnerIds = user.role === 'admin'
            ? [user.id]
            : await getStudentVisibleExamOwnerIds(user.id);
        const papers = await prisma.examPaper.findMany({
            where: { userId: { in: visibleOwnerIds } },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                status: true,
                scope: true,
                difficulty: true,
                requestedCount: true,
                resultsRecordedAt: true,
                createdAt: true,
                questions: { select: { status: true, _count: { select: { practiceRecords: true } } } },
            },
        });

        if (user.role !== 'admin') {
            const submissions = await prisma.studentSubmission.findMany({
                where: { userId: user.id, kind: 'exam', examPaperId: { in: papers.map((paper) => paper.id) } },
                select: { examPaperId: true },
                distinct: ['examPaperId'],
            });
            const recordedIds = new Set(submissions.flatMap((submission) => submission.examPaperId ? [submission.examPaperId] : []));
            return NextResponse.json(papers.map(({ questions, ...paper }) => ({
                ...paper,
                questionCount: questions.length,
                readyCount: questions.filter((question) => question.status === 'ready').length,
                recordedCount: recordedIds.has(paper.id) ? 1 : 0,
            })));
        }

        return NextResponse.json(papers.map(({ questions, ...paper }) => ({
            ...paper,
            questionCount: questions.length,
            readyCount: questions.filter((question) => question.status === 'ready').length,
            recordedCount: questions.filter((question) => question._count.practiceRecords > 0).length,
        })));
    } catch (error) {
        logger.error({ error }, 'Error listing exam papers');
        return internalError("Failed to list exam papers");
    }
}

/**
 * POST /api/exams
 * 按条件与抽题规则（默认优先练习较少的题目）抽取错题，创建试卷并在后台生成举一反三题目
 */
export async function POST(req: Request) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("Invalid exam options", parsed.error.issues);
        }
        const { subjectIds, tagNames, paperLevelIds, scope, count, pickRule, difficulty, language } = parsed.data;

        const sourceUserIds = user.role === 'admin'
            ? [user.id]
            : (await prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } })).map((admin) => admin.id);
        if (sourceUserIds.length === 0) return badRequest("NO_SOURCE_ITEMS");

        // 管理员使用自己的错题本；学生只读共享所有管理员的题库。
        const notebooks = await prisma.subject.findMany({
            where: { id: { in: subjectIds }, userId: user.role === 'admin' ? user.id : { in: sourceUserIds } },
            select: { id: true, name: true },
        });
        if (notebooks.length === 0 || notebooks.length !== new Set(subjectIds).size) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        // 校验卷别分组属于当前用户
        if (user.role === 'admin' && paperLevelIds && paperLevelIds.length > 0) {
            const validGroups = await prisma.paperGroup.count({
                where: { id: { in: paperLevelIds }, userId: user.id },
            });
            if (validGroups !== paperLevelIds.length) {
                return validationError("Invalid paperLevelIds", [{ code: 'invalid_paper_level', path: ['paperLevelIds'], message: 'Invalid paper level group' }]);
            }
        }

        const sources = await selectSourceItems(user.id, {
            subjectIds: notebooks.map((notebook) => notebook.id),
            tagNames,
            paperLevelIds: user.role === 'admin' ? paperLevelIds : undefined,
            scope: user.role === 'admin' ? scope : 'all',
            count,
            pickRule,
        }, user.role === 'admin' ? {} : { sourceUserIds });
        if (sources.length === 0) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        if (user.role !== 'admin') {
            const sourceItems = await prisma.errorItem.findMany({
                where: { id: { in: sources.map((source) => source.id) }, userId: { in: sourceUserIds } },
                select: { id: true, shortId: true, questionText: true, answerText: true, analysis: true, figureSvg: true },
            });
            const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
            const paper = await prisma.examPaper.create({
                data: {
                    userId: user.id,
                    title: parsed.data.title || `${notebooks.map((notebook) => notebook.name).join('、')} ${formatDateTime(new Date(), 'yyyy-MM-dd HH:mm', getAppTimeZone())}`,
                    scope: 'all',
                    difficulty,
                    requestedCount: sources.length,
                    subjectIds: JSON.stringify(notebooks.map((notebook) => notebook.id)),
                    tagNames: tagNames && tagNames.length > 0 ? JSON.stringify(tagNames) : null,
                    status: 'ready',
                    questions: {
                        create: sources.flatMap((source, index) => {
                            const item = sourceById.get(source.id);
                            return item?.questionText && item.answerText ? [{
                                order: index + 1,
                                errorItemId: item.id,
                                sourceShortId: item.shortId || item.id,
                                status: 'ready',
                                questionText: item.questionText,
                                answerText: item.answerText,
                                analysis: item.analysis,
                                figureSvg: item.figureSvg,
                            }] : [];
                        }),
                    },
                },
                select: { id: true, title: true, requestedCount: true, _count: { select: { questions: true } } },
            });
            if (paper._count.questions === 0) return badRequest("NO_SOURCE_ITEMS");
            return NextResponse.json({ id: paper.id, title: paper.title, requestedCount: paper.requestedCount, questionCount: paper._count.questions }, { status: 201 });
        }

        const title = parsed.data.title
            || `${notebooks.map((notebook) => notebook.name).join('、')} ${formatDateTime(new Date(), 'yyyy-MM-dd HH:mm', getAppTimeZone())}`;

        const limited = await consumeAiQuota(user, 'exam');
        if (limited) return limited;

        const paper = await prisma.examPaper.create({
            data: {
                userId: user.id,
                title,
                scope,
                difficulty,
                requestedCount: count,
                subjectIds: JSON.stringify(notebooks.map((notebook) => notebook.id)),
                tagNames: tagNames && tagNames.length > 0 ? JSON.stringify(tagNames) : null,
                questions: {
                    create: sources.map((source, index) => ({
                        order: index + 1,
                        errorItemId: source.id,
                        sourceShortId: source.shortId!,
                    })),
                },
            },
            select: { id: true, title: true, requestedCount: true, _count: { select: { questions: true } } },
        });

        void generateExamPaper(paper.id, language || 'zh');

        logger.info({ paperId: paper.id, count: sources.length, requested: count }, 'Exam paper created');
        return NextResponse.json({
            id: paper.id,
            title: paper.title,
            requestedCount: paper.requestedCount,
            questionCount: paper._count.questions,
        }, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating exam paper');
        return internalError("Failed to create exam paper");
    }
}

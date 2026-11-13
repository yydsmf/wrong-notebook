import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, internalError, notFound, unauthorized, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { startStudentSubmissionGrading } from "@/lib/student-answers";
import { getStudentVisibleExamOwnerIds } from "@/lib/shared-exams";
import { getExactSourceImageFragments } from "@/lib/exam-images";

const logger = createLogger("api:student-submissions");
const imageSchema = z.string().max(3_000_000).regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i);
const answerSchema = z.object({
    errorItemId: z.string().min(1).optional(),
    examQuestionId: z.string().min(1).optional(),
    userAnswer: z.string().trim().max(10000).optional().default(""),
    userAnswerImageUrl: imageSchema.optional(),
}).refine((answer) => Boolean(answer.errorItemId) !== Boolean(answer.examQuestionId), "Exactly one question source is required")
    .refine((answer) => Boolean(answer.userAnswer) || Boolean(answer.userAnswerImageUrl), "An answer is required");

const createSchema = z.object({
    kind: z.enum(["review", "exam"]),
    examPaperId: z.string().min(1).optional(),
    answers: z.array(answerSchema).min(1).max(100),
}).refine((data) => data.kind === "exam" ? Boolean(data.examPaperId) : !data.examPaperId);

/** 创建学生独立答题批次；参考答案始终仅在服务端读取并保存快照。 */
export async function POST(req: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (user.role !== "user") return badRequest("Student submissions are only available to student accounts");

    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError("Invalid submission", parsed.error.issues);
    const { kind, examPaperId, answers } = parsed.data;

    try {
        const itemIds = answers.flatMap((answer) => answer.errorItemId ? [answer.errorItemId] : []);
        const questionIds = answers.flatMap((answer) => answer.examQuestionId ? [answer.examQuestionId] : []);
        if (new Set(itemIds).size !== itemIds.length || new Set(questionIds).size !== questionIds.length) {
            return badRequest("Duplicate question in submission");
        }

        let snapshots: {
            errorItemId?: string;
            examQuestionId?: string;
            questionText: string;
            answerText: string;
            analysis: string | null;
            originalImageUrl: string | null;
            figureSvg: string | null;
            imageFragments: string | null;
            userAnswer: string;
            userAnswerImageUrl: string | null;
        }[];

        if (kind === "review") {
            const admins = await prisma.user.findMany({ where: { role: "admin", isActive: true }, select: { id: true } });
            const items = await prisma.errorItem.findMany({
                where: {
                    id: { in: itemIds },
                    userId: { in: admins.map((admin) => admin.id) },
                    questionText: { not: null },
                    answerText: { not: null },
                },
                select: { id: true, questionText: true, answerText: true, analysis: true, originalImageUrl: true, figureSvg: true, imageFragments: true },
            });

            if (items.length !== answers.length || itemIds.length !== answers.length) return notFound("Shared question not found");
            const byId = new Map(items.map((item) => [item.id, item]));
            snapshots = answers.map((answer) => {
                const item = byId.get(answer.errorItemId!)!;
                return {
                    errorItemId: item.id,
                    questionText: item.questionText || "",
                    answerText: item.answerText || "",
                    analysis: item.analysis,
                    originalImageUrl: item.originalImageUrl,
                    figureSvg: item.figureSvg,
                    imageFragments: item.imageFragments,
                    userAnswer: answer.userAnswer,
                    userAnswerImageUrl: answer.userAnswerImageUrl ?? null,
                };
            });
        } else {
            const visibleOwnerIds = await getStudentVisibleExamOwnerIds(user.id);
            const paper = await prisma.examPaper.findFirst({ where: { id: examPaperId, userId: { in: visibleOwnerIds } }, select: { id: true } });
            if (!paper) return notFound("Exam paper not found");
            const questions = await prisma.examQuestion.findMany({
                where: { id: { in: questionIds }, paperId: paper.id, status: "ready" },
                include: { errorItem: { select: { questionText: true, imageFragments: true } } },
            });
            if (questions.length !== answers.length || questionIds.length !== answers.length) return notFound("Exam question not found");
            const byId = new Map(questions.map((question) => [question.id, question]));
            snapshots = answers.map((answer) => {
                const question = byId.get(answer.examQuestionId!)!;
                return {
                    examQuestionId: question.id,
                    questionText: question.questionText || "",
                    answerText: question.answerText || "",
                    analysis: question.analysis,
                    originalImageUrl: null,
                    figureSvg: question.figureSvg ?? null,
                    imageFragments: getExactSourceImageFragments(
                        question.questionText,
                        question.errorItem?.questionText,
                        question.errorItem?.imageFragments,
                    ),
                    userAnswer: answer.userAnswer,
                    userAnswerImageUrl: answer.userAnswerImageUrl ?? null,
                };
            });
        }

        const submission = await prisma.studentSubmission.create({
            data: {
                userId: user.id,
                kind,
                examPaperId,
                totalCount: snapshots.length,
                answers: { create: snapshots },
            },
            select: { id: true },
        });
        startStudentSubmissionGrading(submission.id);
        return NextResponse.json({ id: submission.id, status: "grading" }, { status: 201 });
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, "Failed to create student submission");
        return internalError("Failed to submit answers");
    }
}

export async function GET(req: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind");
    const examPaperId = searchParams.get("examPaperId");
    if (kind !== "review" && kind !== "exam") return badRequest("Invalid submission kind");
    if (kind === "exam" && !examPaperId) return badRequest("examPaperId is required");

    try {
        const submissions = await prisma.studentSubmission.findMany({
            where: { userId: user.id, kind, ...(examPaperId ? { examPaperId } : {}) },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
                answers: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        errorItemId: true,
                        examQuestionId: true,
                        questionText: true,
                        answerText: true,
                        analysis: true,
                        figureSvg: true,
                        imageFragments: true,
                        userAnswer: true,
                        userAnswerImageUrl: true,
                        status: true,
                        isCorrect: true,
                        reason: true,
                        mistakeAnalysis: true,
                    },
                },
            },
        });
        const submission = submissions[0];
        if (!submission) return NextResponse.json(null);
        if (submission.status === "grading") startStudentSubmissionGrading(submission.id);
        const { answers, ...summary } = submission;
        return NextResponse.json({
            ...summary,
            answers: answers.map(({ answerText, analysis, ...answer }) => ({
                ...answer,
                ...(answer.status === "graded" ? { answerText, analysis } : {}),
            })),
        });
    } catch (error) {
        logger.error({ error, userId: user.id }, "Failed to list student submissions");
        return internalError("Failed to fetch submissions");
    }
}

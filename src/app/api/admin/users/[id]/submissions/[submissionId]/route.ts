import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { forbidden, internalError, notFound, validationError } from "@/lib/api-errors";
import { submissionPagination, submissionPaginationSchema, submissionSummarySelect } from "@/lib/admin-submissions";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:admin:submission-detail");

export async function GET(req: Request, { params }: { params: Promise<{ id: string; submissionId: string }> }) {
    if (!requireAdmin(await getServerSession(authOptions))) return forbidden("Admin access required");
    const { id, submissionId } = await params;
    const parsed = submissionPaginationSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return validationError("Invalid submission query", parsed.error.issues);

    try {
        const { page, pageSize } = parsed.data;
        const submission = await prisma.studentSubmission.findFirst({
            where: { id: submissionId, userId: id },
            select: {
                ...submissionSummarySelect,
                _count: { select: { answers: true } },
                answers: {
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true, errorItemId: true, examQuestionId: true,
                        questionText: true, answerText: true, analysis: true,
                        figureSvg: true, imageFragments: true,
                        userAnswer: true, userAnswerImageUrl: true,
                        status: true, isCorrect: true, reason: true, mistakeAnalysis: true,
                    },
                },
            },
        });
        if (!submission) return notFound("Submission not found");
        const paper = submission.examPaperId ? await prisma.examPaper.findUnique({
            where: { id: submission.examPaperId }, select: { title: true },
        }) : null;
        const { _count, ...detail } = submission;
        return NextResponse.json({
            ...detail,
            examTitle: paper?.title ?? null,
            pagination: submissionPagination(page, pageSize, _count.answers),
        });
    } catch (error) {
        logger.error({ error, userId: id, submissionId }, "读取学生批改详情失败");
        return internalError("Failed to fetch student submission");
    }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { startStudentSubmissionGrading } from "@/lib/student-answers";

const logger = createLogger("api:student-submissions:id");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    try {
        const { id } = await params;
        const submission = await prisma.studentSubmission.findFirst({
            where: { id, userId: user.id },
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
        if (!submission) return notFound("Submission not found");
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
        logger.error({ error }, "Failed to fetch student submission");
        return internalError("Failed to fetch submission");
    }
}

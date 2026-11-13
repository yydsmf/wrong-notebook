import { getAIService } from "@/lib/ai";
import { createLogger } from "@/lib/logger";
import { consumeAiQuota } from "@/lib/ai-quota";
import { prisma } from "@/lib/prisma";

const logger = createLogger("student-answers");
const activeSubmissions = new Set<string>();

export type StudentAnswerMode = "choice" | "boolean" | "written";

export function getStudentAnswerOptions(questionText: string): { mode: StudentAnswerMode; options: { value: string; label: string }[] } {
    if (/判断题|判断下列|正确的打[√✓]|错误的打[×✗]|对的打[√✓]/.test(questionText)) {
        return { mode: "boolean", options: [{ value: "正确", label: "正确" }, { value: "错误", label: "错误" }] };
    }

    const options: { value: string; label: string }[] = [];
    const optionPattern = /(?:^|\n)\s*(?:\(([A-H])\)|([A-H])[.、．)])\s*([^\n]+)/g;
    for (const match of questionText.matchAll(optionPattern)) {
        const value = match[1] || match[2];
        options.push({ value, label: `${value}. ${match[3].trim()}` });
    }
    return options.length >= 2 ? { mode: "choice", options } : { mode: "written", options: [] };
}

export function startStudentSubmissionGrading(submissionId: string): void {
    if (activeSubmissions.has(submissionId)) return;
    activeSubmissions.add(submissionId);
    void gradeStudentSubmission(submissionId).finally(() => activeSubmissions.delete(submissionId));
}

async function gradeStudentSubmission(submissionId: string): Promise<void> {
    try {
        const submission = await prisma.studentSubmission.findUnique({
            where: { id: submissionId },
            include: { user: { select: { id: true, role: true } }, answers: { orderBy: { createdAt: "asc" } } },
        });
        if (!submission || submission.status !== "grading") return;

        await prisma.studentAnswer.updateMany({
            where: { submissionId, status: "grading" },
            data: { status: "pending" },
        });
        const pending = submission.answers.filter((answer) => answer.status === "pending" || answer.status === "grading");

        for (const answer of pending) {
            await prisma.studentAnswer.update({ where: { id: answer.id }, data: { status: "grading" } });
            const limited = await consumeAiQuota(submission.user, "grade");
            if (limited) {
                await prisma.studentAnswer.update({ where: { id: answer.id }, data: { status: "failed" } });
                continue;
            }

            try {
                const imageMatch = answer.userAnswerImageUrl?.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i);
                const result = await getAIService().gradeAnswer({
                    questionText: answer.questionText,
                    answerText: answer.answerText,
                    analysis: answer.analysis,
                    userAnswer: answer.userAnswer || "",
                    userAnswerImage: imageMatch ? { mimeType: imageMatch[1], base64: imageMatch[2] } : undefined,
                });
                await prisma.studentAnswer.update({
                    where: { id: answer.id },
                    data: {
                        status: "graded",
                        isCorrect: result.correct,
                        reason: result.reason,
                        mistakeAnalysis: result.correct ? null : result.mistakeAnalysis || result.reason,
                    },
                });
                await prisma.studentSubmission.update({
                    where: { id: submissionId },
                    data: {
                        gradedCount: { increment: 1 },
                        correctCount: result.correct ? { increment: 1 } : undefined,
                    },
                });
            } catch (error) {
                logger.error({ submissionId, answerId: answer.id, error }, "学生答案判分失败");
                await prisma.studentAnswer.update({ where: { id: answer.id }, data: { status: "failed" } });
            }
        }

        const [gradedCount, failedCount] = await Promise.all([
            prisma.studentAnswer.count({ where: { submissionId, status: "graded" } }),
            prisma.studentAnswer.count({ where: { submissionId, status: "failed" } }),
        ]);
        await prisma.studentSubmission.update({
            where: { id: submissionId },
            data: {
                gradedCount,
                status: failedCount === 0 && gradedCount === submission.totalCount ? "completed" : "failed",
                completedAt: new Date(),
            },
        });
    } catch (error) {
        logger.error({ submissionId, error }, "学生提交判分任务异常");
        await prisma.studentAnswer.updateMany({
            where: { submissionId, status: { in: ["pending", "grading"] } },
            data: { status: "failed" },
        }).catch((updateError: unknown) => {
            logger.error({ submissionId, error: updateError }, "无法标记未完成的学生答案");
        });
        await prisma.studentSubmission.updateMany({ where: { id: submissionId, status: "grading" }, data: { status: "failed" } });
    }
}

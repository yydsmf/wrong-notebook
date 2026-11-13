import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { startStudentSubmissionGrading } from "@/lib/student-answers";

const logger = createLogger("api:student-submissions:retry");

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;

    try {
        const submission = await prisma.studentSubmission.findFirst({ where: { id, userId: user.id } });
        if (!submission || submission.status !== "failed") return notFound("Failed submission not found");
        const failedCount = await prisma.studentAnswer.count({ where: { submissionId: id, status: "failed" } });
        if (failedCount === 0) return notFound("Failed answers not found");
        await prisma.studentAnswer.updateMany({ where: { submissionId: id, status: "failed" }, data: { status: "pending" } });
        await prisma.studentSubmission.update({ where: { id }, data: { status: "grading", completedAt: null } });
        startStudentSubmissionGrading(id);
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error, submissionId: id, userId: user.id }, "Failed to retry student grading");
        return internalError("Failed to retry grading");
    }
}

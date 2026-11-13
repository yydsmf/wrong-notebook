import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getRetagJob, startRetagJob } from "@/lib/retag";
import { consumeAiQuota } from "@/lib/ai-quota";

const logger = createLogger('api:notebooks:retag');

async function findOwnNotebook(id: string, userId: string) {
    const notebook = await prisma.subject.findUnique({ where: { id }, select: { userId: true } });
    return notebook?.userId === userId;
}

/**
 * GET /api/notebooks/:id/retag
 * 查询错题本批量重新生成知识点的进度
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }
        if (!(await findOwnNotebook(id, user.id))) {
            return notFound("Notebook not found");
        }
        return NextResponse.json(getRetagJob(user.id, id));
    } catch (error) {
        logger.error({ error }, 'Error fetching retag job');
        return internalError("Failed to fetch retag status");
    }
}

/**
 * POST /api/notebooks/:id/retag
 * 在后台为错题本中的全部题目重新生成知识点
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }
        if (!(await findOwnNotebook(id, user.id))) {
            return notFound("Notebook not found");
        }
        const limited = await consumeAiQuota(user, 'retag');
        if (limited) return limited;

        return NextResponse.json(await startRetagJob(user.id, id, true), { status: 202 });
    } catch (error) {
        logger.error({ error }, 'Error starting retag job');
        return internalError("Failed to start retag job");
    }
}

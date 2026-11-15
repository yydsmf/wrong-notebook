import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { clearFinishedBackgroundTasks, failBackgroundTaskImportRequest, listBackgroundTasks } from "@/lib/background-tasks";
import { z } from 'zod';

/**
 * GET /api/tasks
 * 当前用户的后台事务：进行中的和最近 3 小时内结束的
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
}

/**
 * DELETE /api/tasks
 * 清除当前用户已结束的事务记录（进行中的不受影响）
 */
export async function DELETE() {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    clearFinishedBackgroundTasks(user.id);
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
}

const failureSchema = z.object({
    taskId: z.string().min(1).max(100).optional(),
    requestId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    error: z.enum(['AI_TIMEOUT_ERROR', 'AI_CONNECTION_FAILED', 'AI_RESPONSE_ERROR', 'QUESTION_SAVE_FAILED', 'IMPORT_CANCELLED']),
}).refine(input => !!input.taskId || !!input.requestId);

/** 浏览器接收或后续保存失败时同步原导入任务，不覆盖已成功入库的结果。 */
export async function PATCH(req: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthorized('Authentication required');
    const parsed = failureSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest('Invalid task outcome');
    failBackgroundTaskImportRequest(user.id, parsed.data, parsed.data.error);
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
}

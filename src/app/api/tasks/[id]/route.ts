import { getCurrentUser } from "@/lib/current-user";
import { notFound, unauthorized } from "@/lib/api-errors";
import { listBackgroundTasks, removeBackgroundTask } from "@/lib/background-tasks";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    if (!removeBackgroundTask(user.id, id)) return notFound("Task not found");
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
}

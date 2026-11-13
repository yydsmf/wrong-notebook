import { prisma } from "@/lib/prisma";

/** Admin-generated papers are shared; each student's submissions remain private. */
export async function getStudentVisibleExamOwnerIds(studentId: string): Promise<string[]> {
    const admins = await prisma.user.findMany({
        where: { role: "admin", isActive: true },
        select: { id: true },
    });

    return [...new Set([studentId, ...admins.map((admin) => admin.id)])];
}

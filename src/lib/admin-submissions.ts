import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const submissionPaginationSchema = z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
});

// 列表只取批次摘要，避免把所有题图和手写答案一起加载到内存。
export const submissionSummarySelect = {
    id: true,
    kind: true,
    examPaperId: true,
    status: true,
    totalCount: true,
    gradedCount: true,
    correctCount: true,
    createdAt: true,
    completedAt: true,
} satisfies Prisma.StudentSubmissionSelect;

export function submissionPagination(page: number, pageSize: number, total: number) {
    return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

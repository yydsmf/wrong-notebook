import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { forbidden, internalError, notFound, validationError } from "@/lib/api-errors";
import { submissionPagination, submissionPaginationSchema, submissionSummarySelect } from "@/lib/admin-submissions";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:admin:user-submissions");
const querySchema = submissionPaginationSchema.extend({ kind: z.enum(["review", "exam"]).default("review") });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!requireAdmin(await getServerSession(authOptions))) return forbidden("Admin access required");
    const { id } = await params;
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return validationError("Invalid submission query", parsed.error.issues);

    try {
        if (!await prisma.user.findUnique({ where: { id }, select: { id: true } })) return notFound("User not found");
        const { kind, page, pageSize } = parsed.data;
        const where = { userId: id, kind };
        const [total, submissions] = await Promise.all([
            prisma.studentSubmission.count({ where }),
            prisma.studentSubmission.findMany({
                where,
                select: submissionSummarySelect,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        const paperIds = [...new Set(submissions.flatMap((item) => item.examPaperId ? [item.examPaperId] : []))];
        const papers = paperIds.length ? await prisma.examPaper.findMany({
            where: { id: { in: paperIds } }, select: { id: true, title: true },
        }) : [];
        const titles = new Map(papers.map((paper) => [paper.id, paper.title]));
        return NextResponse.json({
            submissions: submissions.map((item) => ({ ...item, examTitle: titles.get(item.examPaperId ?? "") ?? null })),
            pagination: submissionPagination(page, pageSize, total),
        });
    } catch (error) {
        logger.error({ error, userId: id }, "读取学生提交列表失败");
        return internalError("Failed to fetch student submissions");
    }
}

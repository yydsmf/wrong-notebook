"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { CalendarCheck, RefreshCw } from "lucide-react";
import { ErrorItemCard } from "@/components/error-list/error-item-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StudentAnswerWorkspace } from "@/components/student-answer-workspace";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { formatDateTime, getDayRange } from "@/lib/date-time";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import { REVIEW_INTERVALS, STUDENT_REVIEW_INTERVALS } from "@/lib/review-schedule";
import type { DueReviewItem, PaginatedResponse, StudentAnswerQuestion, StudentSubmission } from "@/types/api";

export default function ReviewPage() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const { data: session } = useSession();
    usePageTitle(t.review.title);
    const [data, setData] = useState<PaginatedResponse<DueReviewItem> | null>(null);
    const [latestSubmission, setLatestSubmission] = useState<StudentSubmission | null>(null);
    const [submittedSubmissionId, setSubmittedSubmissionId] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [continueReview, setContinueReview] = useState(false);

    const role = session?.user?.role;
    const reviewPageSize = role === "user" ? 1000 : DEFAULT_PAGE_SIZE;
    const fetchDue = useCallback(async (targetPage: number) => {
        try {
            const nextData = await apiClient.get<PaginatedResponse<DueReviewItem>>(`/api/review/due?page=${targetPage}&pageSize=${reviewPageSize}`);
            setData(nextData);
            if (role === "user") {
                try {
                    setLatestSubmission(await apiClient.get<StudentSubmission | null>("/api/student-submissions?kind=review"));
                } catch (error) {
                    frontendLogger.error('[Review]', 'Failed to fetch latest review submission', { error });
                    setLatestSubmission(null);
                }
            } else {
                setLatestSubmission(null);
            }
        } catch (error) {
            frontendLogger.error('[Review]', 'Failed to fetch due reviews', { error });
        }
    }, [reviewPageSize, role]);

    const handleSubmissionUpdate = useCallback((submission: StudentSubmission) => {
        setLatestSubmission(submission);
        setSubmittedSubmissionId(submission.id);
        if (submission.status !== "grading") void fetchDue(1);
    }, [fetchDue]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或翻页时加载，请求完成后更新结果
        void fetchDue(page);
        const refresh = () => void fetchDue(page);
        const timer = window.setInterval(refresh, 60_000);
        window.addEventListener("focus", refresh);
        window.addEventListener("visibilitychange", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("visibilitychange", refresh);
        };
    }, [page, fetchDue]);

    const todayStart = getDayRange(new Date(), timeZone).start;
    const todayEnd = getDayRange(new Date(), timeZone).end;
    const latestAnswers = new Set(latestSubmission?.answers.flatMap((answer) => answer.errorItemId ? [answer.errorItemId] : []) ?? []);
    const latestCoversDueToday = Boolean(
        session?.user?.role === "user"
        && data?.items.length
        && latestSubmission?.kind === "review"
        && new Date(latestSubmission.createdAt) >= todayStart
        && new Date(latestSubmission.createdAt) < todayEnd
        && data.items.every((item) => latestAnswers.has(item.id)),
    );
    const showLatestResult = data?.items.length === 0 || (latestCoversDueToday && submittedSubmissionId === latestSubmission?.id && !continueReview);
    const dueLabel = (item: DueReviewItem) => {
        const date = formatDateTime(item.nextReviewAt, "MM/dd", timeZone);
        return new Date(item.nextReviewAt) < todayStart
            ? t.review.overdue.replace("{date}", date)
            : t.review.dueOn.replace("{date}", date);
    };

    return (
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
            <PageHeader
                title={t.review.title}
                description={t.review.desc}
                actions={data && data.total > 0 && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                        {t.review.dueCount.replace("{count}", String(data.total))}
                    </span>
                )}
            />

            {!data && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-52 animate-pulse rounded-2xl bg-muted" />
                    ))}
                </div>
            )}

            {data && data.total === 0 && session?.user?.role === "admin" && (
                <EmptyState icon={CalendarCheck} title={t.review.empty} description={t.review.emptyHint} />
            )}

            {data && data.total === 0 && session?.user?.role === "user" && !latestSubmission && (
                <EmptyState icon={CalendarCheck} title={t.review.empty} description={t.review.studentEmptyHint} />
            )}

            {data && data.items.length > 0 && session?.user?.role === "admin" && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {data.items.map((item) => (
                        <div key={item.id} className="flex flex-col gap-2">
                            <div className="flex-1">
                                <ErrorItemCard item={item} selectMode={false} selected={false} onToggleSelect={() => {}} selectedTag={null} onTagClick={() => {}} />
                            </div>
                            <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                                <span>{dueLabel(item)} · {t.review.round.replace("{round}", String(item.reviewStage + 1)).replace("{total}", String(session?.user?.role === "user" ? STUDENT_REVIEW_INTERVALS.length : REVIEW_INTERVALS.length))}</span>
                                <Link href={`/practice?id=${item.id}`}>
                                    <Button variant="outline" size="sm" className="h-8">
                                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                        {t.review.practice}
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {data && data.items.length > 0 && session?.user?.role === "user" && !showLatestResult && (
                <StudentAnswerWorkspace
                    kind="review"
                    questions={data.items.map((item): StudentAnswerQuestion => ({
                        id: item.id,
                        questionText: item.questionText || "",
                        figureSvg: item.figureSvg,
                        imageFragments: item.imageFragments,
                        figureScale: item.figureScale,
                        figureAlign: item.figureAlign,
                        mode: item.mode,
                        options: item.options,
                    }))}
                    onSubmissionUpdate={handleSubmissionUpdate}
                />
            )}

            {data && session?.user?.role === "user" && showLatestResult && latestSubmission && (
                <StudentAnswerWorkspace
                    kind="review"
                    questions={[]}
                    initialSubmission={latestSubmission}
                    onContinueReview={data.items.length > 0 && latestCoversDueToday ? () => setContinueReview(true) : undefined}
                    onSubmissionUpdate={handleSubmissionUpdate}
                />
            )}

            {data && session?.user?.role === "admin" && <Pagination page={page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPageChange={setPage} />}
        </main>
    );
}

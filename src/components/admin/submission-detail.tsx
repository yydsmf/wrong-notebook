"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { SubmissionAnswer } from "@/components/admin/submission-answer";
import { SubmissionSummary } from "@/components/admin/submission-summary";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-time";
import { frontendLogger } from "@/lib/frontend-logger";
import type { AdminSubmissionDetail } from "@/types/api";

interface SubmissionDetailProps {
    userId: string;
    submissionId: string;
    onBack: () => void;
}

export function SubmissionDetail({ userId, submissionId, onBack }: SubmissionDetailProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const [page, setPage] = useState(1);
    const [refresh, setRefresh] = useState(0);
    const [data, setData] = useState<AdminSubmissionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 分页或手动刷新后重新读取只读批改记录。
        setLoading(true);
        setFailed(false);
        apiClient.get<AdminSubmissionDetail>(`/api/admin/users/${encodeURIComponent(userId)}/submissions/${encodeURIComponent(submissionId)}`, {
            params: { page: String(page), pageSize: "5" },
        }).then((result) => { if (active) setData(result); })
            .catch((error: unknown) => {
                if (!active) return;
                frontendLogger.error("[AdminSubmissionDetail]", "读取批改详情失败", { error });
                setFailed(true);
            }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [userId, submissionId, page, refresh]);

    return <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" />{t.admin.submissions.backToList}</Button>
            <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />{t.admin.submissions.refresh}
            </Button>
        </div>
        {loading ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t.common.loading}</p>
            : failed ? <p role="alert" className="text-sm text-destructive">{t.admin.submissions.loadFailed}</p>
                : data && <>
                    <div className="space-y-2">
                        <h3 className="break-words text-base font-semibold">{data.kind === "exam" ? data.examTitle || t.admin.submissions.unknownExam : t.admin.submissions.review}</h3>
                        <p className="text-xs text-muted-foreground">{t.admin.submissions.submittedAt}：{formatDateTime(data.createdAt, "yyyy-MM-dd HH:mm", timeZone)}</p>
                        <SubmissionSummary submission={data} />
                        {data.status !== "completed" && <p className="text-xs text-muted-foreground">{t.admin.submissions.partialHint}</p>}
                    </div>
                    <div>{data.answers.map((answer, index) => <SubmissionAnswer
                        key={answer.id} answer={answer} number={(data.pagination.page - 1) * data.pagination.pageSize + index + 1} onViewImage={setImage}
                    />)}</div>
                    {data.answers.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t.admin.dashboard.noData}</p>}
                    <Pagination {...data.pagination} onPageChange={setPage} />
                </>}
        <Dialog open={image !== null} onOpenChange={(open) => { if (!open) setImage(null); }}>
            <DialogContent className="max-h-[95dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto" aria-describedby={undefined}>
                <DialogTitle>{t.studentAnswer.answerImage}</DialogTitle>
                {image && <img src={image} alt={t.studentAnswer.answerImage} className="mx-auto max-h-[80dvh] max-w-full object-contain" />}
            </DialogContent>
        </Dialog>
    </div>;
}

"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Eye, Loader2, RefreshCw } from "lucide-react";
import { SubmissionDetail } from "@/components/admin/submission-detail";
import { SubmissionSummary } from "@/components/admin/submission-summary";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-time";
import { frontendLogger } from "@/lib/frontend-logger";
import type { AdminSubmissionList } from "@/types/api";

export function AdminUserSubmissions({ userId }: { userId: string }) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const [kind, setKind] = useState<"review" | "exam">("review");
    const [page, setPage] = useState(1);
    const [refresh, setRefresh] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [data, setData] = useState<AdminSubmissionList | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (selectedId) return;
        let active = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换记录类型或分页后加载对应用户的提交列表。
        setLoading(true);
        setFailed(false);
        apiClient.get<AdminSubmissionList>(`/api/admin/users/${encodeURIComponent(userId)}/submissions`, {
            params: { kind, page: String(page), pageSize: "10" },
        }).then((result) => { if (active) setData(result); })
            .catch((error: unknown) => {
                if (!active) return;
                frontendLogger.error("[AdminUserSubmissions]", "读取提交列表失败", { error });
                setFailed(true);
            }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [userId, kind, page, refresh, selectedId]);

    return <section aria-label={t.admin.submissions.title} className="min-w-0 space-y-4 border-t pt-6">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="size-4" />{t.admin.submissions.title}</h2>
        {selectedId ? <SubmissionDetail key={selectedId} userId={userId} submissionId={selectedId} onBack={() => setSelectedId(null)} /> : <Tabs value={kind} onValueChange={(value) => { setKind(value as "review" | "exam"); setPage(1); }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList aria-label={t.admin.submissions.title}>
                    <TabsTrigger value="review">{t.admin.submissions.review}</TabsTrigger>
                    <TabsTrigger value="exam">{t.admin.submissions.exam}</TabsTrigger>
                </TabsList>
                <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />{t.admin.submissions.refresh}
                </Button>
            </div>
            <TabsContent value={kind}>
            {loading ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t.common.loading}</p>
                : failed ? <p role="alert" className="py-4 text-sm text-destructive">{t.admin.submissions.loadFailed}</p>
                    : data && <>
                        <p className="text-sm text-muted-foreground">{t.admin.submissions.total.replace("{count}", String(data.pagination.total))}</p>
                        {data.submissions.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t.admin.submissions.empty}</p> : <div className="divide-y">
                            {data.submissions.map((submission) => <div key={submission.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 space-y-2">
                                    <p className="break-words text-sm font-medium">{kind === "exam" ? submission.examTitle || t.admin.submissions.unknownExam : t.admin.submissions.review}</p>
                                    <p className="text-xs text-muted-foreground">{t.admin.submissions.submittedAt}：{formatDateTime(submission.createdAt, "yyyy-MM-dd HH:mm", timeZone)}</p>
                                    <SubmissionSummary submission={submission} />
                                </div>
                                <Button variant="outline" size="sm" className="self-start sm:shrink-0" onClick={() => setSelectedId(submission.id)}>
                                    <Eye className="size-4" />{t.admin.submissions.view}
                                </Button>
                            </div>)}
                        </div>}
                        <Pagination {...data.pagination} onPageChange={setPage} />
                    </>}
            </TabsContent>
        </Tabs>}
    </section>;
}

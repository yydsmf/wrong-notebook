"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle2, ListTodo, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-time";
import { toast } from "@/lib/feedback";
import type { BackgroundTask } from "@/lib/background-tasks";

interface RetryImportResponse {
    retryImport?: {
        parsedData: unknown;
        imageBase64: string;
        subjectId: string | null;
        confirmBeforeImport: boolean;
        returnPath: string;
    };
}

/** 弹框打开时的刷新间隔；关闭时只低频刷新进行中的数量 */
const OPEN_POLL_MS = 2000;
const CLOSED_POLL_MS = 15000;

// 登录、注册和打印页面不显示
const HIDDEN_PATHS = [/^\/login/, /^\/register/, /^\/print-preview/, /^\/exams\/[^/]+\/print/];

function formatElapsed(fromIso: string, toIso: string | null, now: number): string {
    const seconds = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : now) - Date.parse(fromIso)) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * 页面右下角的「后台任务」按钮：显示进行中的事务数，点击后弹框查看识别题目、生成动画讲解、
 * 重新解题、批量标注、生成试卷等耗时事务的进度与结果。
 */
export function BackgroundTasksButton() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const { data: session, status } = useSession();
    const pathname = usePathname();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<BackgroundTask[]>([]);
    const [now, setNow] = useState(() => Date.now());
    const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);

    const hidden = status !== "authenticated" || session?.user?.role !== "admin"
        || HIDDEN_PATHS.some((pattern) => pattern.test(pathname || ""));

    const refresh = useCallback(async () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        try {
            const result = await apiClient.get<{ tasks: BackgroundTask[] }>("/api/tasks");
            setTasks(result.tasks);
            setNow(Date.now());
        } catch {
            // 查询失败时保留上次结果，下次轮询再试
        }
    }, []);

    useEffect(() => {
        if (hidden) return;
        // 立即查询一次（放到下一轮事件循环，避免在 effect 中同步更新状态），之后定时刷新
        const first = setTimeout(refresh, 0);
        const timer = setInterval(refresh, open ? OPEN_POLL_MS : CLOSED_POLL_MS);
        return () => {
            clearTimeout(first);
            clearInterval(timer);
        };
    }, [hidden, open, refresh]);

    if (hidden) return null;

    const runningCount = tasks.filter((task) => task.status === "running").length;
    const hasFinished = tasks.some((task) => task.status !== "running");
    const errorText = (code: string | null) => {
        if (!code) return null;
        const mapped = (t.backgroundTasks.errors as Record<string, string>)[code] ?? (t.errors as Record<string, unknown>)[code];
        return typeof mapped === "string" ? mapped : code;
    };

    const clearFinished = async () => {
        try {
            const result = await apiClient.delete<{ tasks: BackgroundTask[] }>("/api/tasks");
            setTasks(result.tasks);
        } catch {
            // 忽略，下次轮询会刷新
        }
    };

    const retryTask = async (task: BackgroundTask) => {
        if (!task.canRetry || retryingTaskId) return;
        setRetryingTaskId(task.id);
        try {
            const result = await apiClient.post<RetryImportResponse>(`/api/tasks/${task.id}/retry`, {}, { timeout: 10 * 60 * 1000, recoverable: true });
            if (result?.retryImport) {
                try {
                    sessionStorage.setItem("background-task-retry-import", JSON.stringify(result.retryImport));
                } catch {
                    toast.error(t.backgroundTasks.retryImportRestoreFailed);
                    await refresh();
                    return;
                }
                await refresh();
                setOpen(false);
                router.push(result.retryImport.returnPath || task.link || "/");
                return;
            }
            await refresh();
        } catch {
            await refresh();
        } finally {
            setRetryingTaskId(null);
        }
    };

    return (
        <>
            <Button
                variant="outline"
                size="icon"
                className="fixed bottom-20 right-4 z-40 h-11 w-11 rounded-full shadow-lg md:bottom-6 md:right-6 print:hidden"
                onClick={() => setOpen(true)}
                aria-label={t.backgroundTasks.title}
                title={t.backgroundTasks.title}
            >
                {runningCount > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <ListTodo className="h-5 w-5" />}
                {runningCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
                        {runningCount}
                    </span>
                )}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t.backgroundTasks.title}</DialogTitle>
                        <DialogDescription>{t.backgroundTasks.description}</DialogDescription>
                    </DialogHeader>

                    {tasks.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">{t.backgroundTasks.empty}</p>
                    ) : (
                        <ul className="space-y-2">
                            {tasks.map((task) => (
                                <li key={task.id} className="rounded-md border p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                        {task.status === "running" && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />}
                                        {task.status === "succeeded" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />}
                                        {task.status === "failed" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="font-medium">
                                                {t.backgroundTasks.kinds[task.kind]}
                                                <span className="font-normal text-muted-foreground"> · {t.backgroundTasks.status[task.status]}</span>
                                            </div>
                                            {task.subject && <div className="break-words text-muted-foreground">{task.subject}</div>}
                                            {task.progress && task.progress.total > 0 && (
                                                <div className="space-y-1">
                                                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                                                        <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((task.progress.done / task.progress.total) * 100)}%` }} />
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {t.backgroundTasks.progress
                                                            .replace("{done}", String(task.progress.done))
                                                            .replace("{total}", String(task.progress.total))}
                                                        {task.progress.failed > 0 && ` · ${t.backgroundTasks.failedCount.replace("{count}", String(task.progress.failed))}`}
                                                    </div>
                                                </div>
                                            )}
                                            {task.error && <div className="text-xs text-destructive">{errorText(task.error)}</div>}
                                            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                                                <span>{t.backgroundTasks.startedAt.replace("{time}", formatDateTime(task.startedAt, "HH:mm:ss", timeZone))}</span>
                                                <span>{t.backgroundTasks.elapsed.replace("{time}", formatElapsed(task.startedAt, task.finishedAt, now))}</span>
                                                {task.link && (
                                                    <Link href={task.link} className="text-primary hover:underline" onClick={() => setOpen(false)}>
                                                        {t.backgroundTasks.view}
                                                    </Link>
                                                )}
                                                {task.status === "failed" && task.canRetry && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 gap-1 px-2 text-xs"
                                                        onClick={() => retryTask(task)}
                                                        disabled={retryingTaskId !== null}
                                                    >
                                                        <RefreshCw className={retryingTaskId === task.id ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                                                        {retryingTaskId === task.id ? t.backgroundTasks.retrying : t.backgroundTasks.retry}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-xs text-muted-foreground">{t.backgroundTasks.retentionHint}</p>
                        {hasFinished && (
                            <Button variant="ghost" size="sm" onClick={clearFinished}>{t.backgroundTasks.clearFinished}</Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

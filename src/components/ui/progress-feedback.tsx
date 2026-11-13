"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/lib/use-is-client";

export type ProgressStatus =
    | 'compressing'
    | 'uploading'
    | 'requesting'
    | 'thinking'
    | 'waiting'
    | 'collecting'
    | 'analyzing'
    | 'processing'
    | 'saving'
    | 'completed'
    | 'idle';

interface ProgressFeedbackProps {
    status: ProgressStatus;
    /** AI 请求的前端超时时间，用于估算分析阶段的等待进度 */
    timeoutMs?: number;
    /** 服务端通过请求状态轮询上报的阶段估算值 */
    progress?: number;
    message?: string;
    className?: string;
}

type ActiveProgressStatus = Exclude<ProgressStatus, 'idle'>;
type ActiveProgressFeedbackProps = Omit<ProgressFeedbackProps, 'status'> & { status: ActiveProgressStatus };

// 非 AI 阶段按流程节点估算；AI 阶段没有真实流式进度，按等待时间平滑估算。
const STAGE_ESTIMATES: Record<ActiveProgressStatus, number> = {
    compressing: 10,
    uploading: 20,
    requesting: 15,
    thinking: 30,
    waiting: 45,
    collecting: 90,
    analyzing: 25,
    processing: 85,
    saving: 95,
    completed: 100,
};

const DEFAULT_ANALYSIS_TIMEOUT_MS = 180000;
const ANALYSIS_PROGRESS_START = 25;
const ANALYSIS_PROGRESS_END = 80;

function getProgress(status: ActiveProgressStatus, elapsedSeconds: number, timeoutMs: number): number {
    if (status !== 'analyzing') return STAGE_ESTIMATES[status];

    const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_ANALYSIS_TIMEOUT_MS;
    const ratio = Math.min(1, (elapsedSeconds * 1000) / safeTimeoutMs);
    return Math.round(ANALYSIS_PROGRESS_START + (ANALYSIS_PROGRESS_END - ANALYSIS_PROGRESS_START) * ratio);
}

function formatElapsedTime(seconds: number): string {
    const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
    if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
    return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

export function ProgressFeedback({ status, timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS, progress, message, className }: ProgressFeedbackProps) {
    // 确保只在客户端挂载完成后才渲染遮罩层，防止 SSR/Hydration 问题
    const isMounted = useIsClient();

    // 只有在客户端挂载完成且 status 不为 idle 时才渲染
    if (!isMounted || status === 'idle') return null;

    // 进入 idle 后卸载计时器，新任务重新挂载；切换阶段时保留本次任务的起点。
    return <ActiveProgressFeedback status={status} timeoutMs={timeoutMs} progress={progress} message={message} className={className} />;
}

function ActiveProgressFeedback({ status, timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS, progress: progressOverride, message, className }: ActiveProgressFeedbackProps) {
    const { t } = useLanguage();
    const [startedAt] = useState(() => Date.now());
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, [startedAt]);

    const progress = typeof progressOverride === 'number'
        ? Math.max(0, Math.min(100, Math.round(progressOverride)))
        : getProgress(status, elapsedSeconds, timeoutMs);
    const estimateLabel = t.common.progress.estimated.replace('{percent}', String(progress));

    return (
        <div className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm",
            className
        )}>
            <div className="w-full max-w-md p-6 space-y-6 bg-card rounded-lg border shadow-lg mx-4">
                <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="relative">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            {/* Optional: Add an icon inside the spinner if needed */}
                        </div>
                    </div>

                    <div className="space-y-2 w-full">
                        <h3 className="text-lg font-semibold tracking-tight" aria-live="polite">
                            {message || t.common.progress[status]}
                        </h3>
                        <Progress value={progress} aria-label={estimateLabel} aria-valuetext={estimateLabel} className="h-2 w-full" />
                    </div>

                    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground tabular-nums">
                        <span>{estimateLabel}</span>
                        <span role="timer" aria-live="off">{t.common.progress.elapsed.replace('{time}', formatElapsedTime(elapsedSeconds))}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.common.progress.estimateHint}</p>
                </div>
            </div>
        </div>
    );
}


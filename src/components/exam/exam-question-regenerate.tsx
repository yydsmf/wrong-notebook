"use client";

import { useState } from "react";
import { ImagePlus, Loader2, RefreshCw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast, confirmDialog } from "@/lib/feedback";
import type { ExamQuestionDetail } from "@/types/api";

/** 生成题目或完整解答较长，等待上限与重新解答一致 */
const REGENERATE_TIMEOUT_MS = 10 * 60 * 1000;

type RegenerateMode = "question" | "answer" | "figure";
type RegeneratedFields = Pick<ExamQuestionDetail, "status" | "questionText" | "answerText" | "analysis" | "figureSvg" | "error">;

interface ExamQuestionRegenerateProps {
    paperId: string;
    question: ExamQuestionDetail;
    onDone: (updated: RegeneratedFields) => void;
}

/** 单题重新生成：未录入结果时可重新生成题目和解答，录入后只能重新生成解答 */
export function ExamQuestionRegenerate({ paperId, question, onDone }: ExamQuestionRegenerateProps) {
    const { t, language } = useLanguage();
    const [running, setRunning] = useState<RegenerateMode | null>(null);
    const canRegenerateQuestion = question.attempts.length === 0 && !!question.errorItemId && question.status !== "pending";
    const canRegenerateAnswer = question.status === "ready" && !!question.questionText?.trim();
    const canRegenerateFigure = question.status === "ready" && !!question.questionText?.trim() && !!question.errorItemId;
    if (!canRegenerateQuestion && !canRegenerateAnswer && !canRegenerateFigure) return null;

    const run = async (mode: RegenerateMode) => {
        const confirmText = mode === "question"
            ? t.exam.regenerateQuestionConfirm
            : mode === "answer" ? t.exam.regenerateAnswerConfirm : t.exam.regenerateFigureConfirm;
        if (!(await confirmDialog(confirmText))) return;
        setRunning(mode);
        try {
            const updated = await apiClient.post<RegeneratedFields>(
                `/api/exams/${paperId}/questions/${question.id}/regenerate`, { mode, language }, { timeout: REGENERATE_TIMEOUT_MS, recoverable: true }
            );
            onDone(updated);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            const mapped = (t.errors as Record<string, unknown>)[code];
            frontendLogger.error('[ExamRegenerate]', 'Failed to regenerate exam question', { mode, code });
            const figureError = code === "NO_ORIGINAL_IMAGE"
                ? t.exam.regenerateFigureNoSource
                : code === "NO_FIGURE_GENERATED"
                    ? t.exam.regenerateFigureEmpty
                    : null;
            toast.error(code === "HAS_RESULTS" ? t.exam.regenerateHasResults : figureError || (typeof mapped === "string" ? mapped : t.exam.regenerateFailed));
        } finally {
            setRunning(null);
        }
    };

    return (
        <div className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap gap-1">
                {canRegenerateQuestion && (
                    <Button variant="ghost" size="sm" onClick={() => run("question")} disabled={running !== null}>
                        {running === "question" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                        {running === "question" ? t.exam.regenerating : t.exam.regenerateQuestion}
                    </Button>
                )}
                {canRegenerateAnswer && (
                    <Button variant="ghost" size="sm" onClick={() => run("answer")} disabled={running !== null}>
                        {running === "answer" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-1 h-4 w-4" />}
                        {running === "answer" ? t.exam.regenerating : t.exam.regenerateAnswer}
                    </Button>
                )}
            </div>
            {canRegenerateFigure && (
                <Button variant="ghost" size="sm" onClick={() => run("figure")} disabled={running !== null}>
                    {running === "figure" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />}
                    {running === "figure" ? t.exam.regeneratingFigure : t.exam.regenerateFigure}
                </Button>
            )}
        </div>
    );
}

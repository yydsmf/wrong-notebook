"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuestionFigure } from "@/components/question-figure";
import { QuestionTextRenderer } from "@/components/question-text-renderer";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { parseImageFragments } from "@/lib/image-fragments";
import { processImageFile } from "@/lib/image-utils";
import type { StudentAnswerQuestion, StudentSubmission } from "@/types/api";

interface StudentAnswerWorkspaceProps {
    kind: "review" | "exam";
    questions: StudentAnswerQuestion[];
    examPaperId?: string;
}

interface DraftAnswer {
    text: string;
    image: string | null;
    processing: boolean;
}

function hasAnswer(answer?: DraftAnswer) {
    return Boolean(answer?.text.trim() || answer?.image);
}

export function StudentAnswerWorkspace({ kind, questions, examPaperId }: StudentAnswerWorkspaceProps) {
    const { t } = useLanguage();
    const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
    const [submission, setSubmission] = useState<StudentSubmission | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);
    const answersComplete = questions.length > 0 && questions.every((question) => hasAnswer(drafts[question.id]));
    const resultByQuestion = useMemo(() => new Map(
        (submission?.answers ?? []).map((answer) => [answer.errorItemId || answer.examQuestionId || "", answer]),
    ), [submission]);

    const loadLatest = useCallback(async () => {
        try {
            const query = new URLSearchParams({ kind });
            if (examPaperId) query.set("examPaperId", examPaperId);
            const result = await apiClient.get<StudentSubmission | null>(`/api/student-submissions?${query}`);
            setSubmission(result);
        } catch (loadError) {
            frontendLogger.error("[StudentAnswer]", "Failed to load submission", { loadError });
        }
    }, [examPaperId, kind]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 加载当前学生最近一次提交
        void loadLatest();
    }, [loadLatest]);

    useEffect(() => {
        if (submission?.status !== "grading") return;
        const timer = window.setTimeout(() => void loadLatest(), 2500);
        return () => window.clearTimeout(timer);
    }, [loadLatest, submission?.status, submission?.gradedCount]);

    const updateDraft = (questionId: string, patch: Partial<DraftAnswer>) => {
        setDrafts((current) => ({
            ...current,
            [questionId]: { ...{ text: "", image: null, processing: false }, ...current[questionId], ...patch },
        }));
    };

    const submit = async () => {
        if (!answersComplete || submitting || Object.values(drafts).some((answer) => answer.processing)) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await apiClient.post<{ id: string; status: "grading" }>("/api/student-submissions", {
                kind,
                examPaperId,
                answers: questions.map((question) => ({
                    ...(kind === "review" ? { errorItemId: question.id } : { examQuestionId: question.id }),
                    userAnswer: drafts[question.id]?.text.trim() || "",
                    userAnswerImageUrl: drafts[question.id]?.image || undefined,
                })),
            });
            setDrafts({});
            const fresh = await apiClient.get<StudentSubmission>(`/api/student-submissions/${result.id}`);
            setSubmission(fresh);
        } catch (submitError) {
            frontendLogger.error("[StudentAnswer]", "Failed to submit answers", { submitError });
            setError(t.studentAnswer.submitError);
        } finally {
            setSubmitting(false);
        }
    };

    const retryFailed = async () => {
        if (!submission || retrying) return;
        setRetrying(true);
        try {
            await apiClient.post(`/api/student-submissions/${submission.id}/retry`, {});
            await loadLatest();
        } catch (retryError) {
            frontendLogger.error("[StudentAnswer]", "Failed to retry grading", { retryError });
        } finally {
            setRetrying(false);
        }
    };

    const scoreDenominator = submission?.gradedCount ?? 0;

    return (
        <div className="space-y-4 pb-6">
            {questions.length === 0 && !submission && <p className="py-12 text-center text-sm text-muted-foreground">{t.studentAnswer.noQuestions}</p>}

            {questions.map((question, index) => {
                const mode = question.mode || "written";
                const draft = drafts[question.id] || { text: "", image: null, processing: false };
                const result = resultByQuestion.get(question.id);
                const fragments = Array.isArray(question.imageFragments)
                    ? question.imageFragments
                    : parseImageFragments(typeof question.imageFragments === "string" ? question.imageFragments : null);
                return (
                    <Card key={question.id} className="rounded-lg">
                        <CardContent className="space-y-4 p-4 sm:p-5">
                            <div className="flex items-start gap-3">
                                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums">{index + 1}</span>
                                <QuestionTextRenderer content={question.questionText} className="min-w-0 flex-1 text-base" />
                            </div>

                            {(question.figureSvg || fragments.length > 0) && (
                                <QuestionFigure svg={question.figureSvg} images={fragments} scale={question.figureScale} align={question.figureAlign} />
                            )}
                            {mode !== "written" && (
                                <div role="radiogroup" aria-label={t.studentAnswer.selectOption} className="grid gap-2 sm:grid-cols-2">
                                    {(question.options || []).map((option) => {
                                        const selected = draft.text === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                role="radio"
                                                aria-checked={selected}
                                                onClick={() => updateDraft(question.id, { text: option.value })}
                                                className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm transition-colors ${selected ? "border-primary bg-primary/10 text-foreground" : "bg-background hover:bg-muted/60"}`}
                                            >
                                                <span className="mr-2 inline-grid size-5 place-items-center rounded-full border text-xs font-semibold">{selected ? <Check className="size-3.5" /> : option.value}</span>
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {mode === "written" && (
                                <div className="space-y-3">
                                    <label className="block space-y-2 text-sm font-medium">
                                        <span>{t.studentAnswer.writeAnswer}</span>
                                        <Textarea
                                            value={draft.text}
                                            onChange={(event) => updateDraft(question.id, { text: event.target.value })}
                                            placeholder={t.studentAnswer.answerPlaceholder}
                                            rows={3}
                                            maxLength={10000}
                                        />
                                    </label>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
                                            {draft.processing ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                                            {draft.processing ? t.studentAnswer.processingImage : t.studentAnswer.uploadImage}
                                            <input
                                                className="sr-only"
                                                type="file"
                                                accept="image/*,.heic,.heif"
                                                disabled={draft.processing}
                                                onChange={async (event) => {
                                                    const file = event.currentTarget.files?.[0];
                                                    event.currentTarget.value = "";
                                                    if (!file) return;
                                                    updateDraft(question.id, { processing: true });
                                                    try {
                                                        updateDraft(question.id, { image: await processImageFile(file) });
                                                    } catch (imageError) {
                                                        frontendLogger.error("[StudentAnswer]", "Failed to process answer image", { imageError });
                                                        setError(t.studentAnswer.submitError);
                                                    } finally {
                                                        updateDraft(question.id, { processing: false });
                                                    }
                                                }}
                                            />
                                        </label>
                                        {draft.image && (
                                            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => updateDraft(question.id, { image: null })}>
                                                <X className="size-3.5" />{t.studentAnswer.removeImage}
                                            </button>
                                        )}
                                    </div>
                                    {draft.image && <img src={draft.image} alt={t.studentAnswer.answerImage} className="max-h-56 max-w-full rounded border bg-white object-contain" />}
                                </div>
                            )}

                            {result && (
                                <div className="space-y-3 border-t pt-3">
                                    <p className={`flex items-center gap-2 text-sm font-semibold ${result.status === "failed" || result.status === "pending" || result.status === "grading" ? "text-muted-foreground" : result.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                                        {result.status === "pending" || result.status === "grading"
                                            ? <Loader2 className="size-4 animate-spin" />
                                            : result.status === "graded" && result.isCorrect ? <Check className="size-4" /> : <X className="size-4" />}
                                        {result.status === "pending" || result.status === "grading"
                                            ? t.studentAnswer.grading
                                            : result.status === "failed" ? t.studentAnswer.failed : result.isCorrect ? t.studentAnswer.correct : t.studentAnswer.incorrect}
                                    </p>
                                    {result.reason && <p className="text-sm text-muted-foreground">{t.studentAnswer.reason}：{result.reason}</p>}
                                    {result.mistakeAnalysis && <p className="text-sm"><span className="font-medium">{t.studentAnswer.mistake}：</span>{result.mistakeAnalysis}</p>}
                                    {result.status === "graded" && !result.isCorrect && result.answerText && (
                                        <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
                                            <p><span className="font-medium">{t.studentAnswer.referenceAnswer}：</span>{result.answerText}</p>
                                            {result.analysis && <p><span className="font-medium">{t.studentAnswer.analysis}：</span>{result.analysis}</p>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}

            {questions.length > 0 && <div className="space-y-3 border-t pt-4">
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button className="w-full sm:w-auto" onClick={() => void submit()} disabled={!answersComplete || submitting || submission?.status === "grading" || Object.values(drafts).some((answer) => answer.processing)}>
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {submitting ? t.studentAnswer.submitting : t.studentAnswer.submit}
                </Button>
            </div>}

            {submission && (
                <section aria-live="polite" className="space-y-3 border-t pt-4">
                    <h2 className="text-base font-semibold">{t.studentAnswer.resultTitle}</h2>
                    {submission.status === "grading" ? (
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>{t.studentAnswer.grading} · {t.studentAnswer.gradingProgress.replace("{done}", String(submission.gradedCount)).replace("{total}", String(submission.totalCount))}</span>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                            {scoreDenominator > 0 && <span className="font-semibold">{t.studentAnswer.score}：{submission.correctCount} / {scoreDenominator}</span>}
                            {submission.status === "completed" ? <span className="text-green-700 dark:text-green-400">{t.studentAnswer.completed}</span> : <span className="text-muted-foreground">{t.studentAnswer.incomplete}</span>}
                            {submission.status === "failed" && (
                                <Button variant="outline" size="sm" onClick={() => void retryFailed()} disabled={retrying}>
                                    {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                                    {t.studentAnswer.retryGrading}
                                </Button>
                            )}
                        </div>
                    )}
                    {questions.length === 0 && submission.answers.map((answer, index) => (
                        <Card key={answer.id} className="rounded-lg">
                            <CardContent className="space-y-2 p-4">
                                <div className="flex items-start gap-3">
                                    <span className="text-sm font-semibold tabular-nums">{index + 1}.</span>
                                    <QuestionTextRenderer content={answer.questionText} className="min-w-0 flex-1 text-sm" />
                                </div>
                                <p className={`text-sm font-medium ${answer.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                                    {answer.status === "failed" ? t.studentAnswer.failed : answer.isCorrect ? t.studentAnswer.correct : t.studentAnswer.incorrect}
                                    {answer.reason ? ` · ${answer.reason}` : ""}
                                </p>
                            </CardContent>
                        </Card>
                    ))}
                </section>
            )}
        </div>
    );
}

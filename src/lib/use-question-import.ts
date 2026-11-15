"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ParsedQuestion } from "@/lib/ai";
import { getAnalysisErrorMessage } from "@/lib/analysis-error";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { processImageFile } from "@/lib/image-utils";
import { normalizeMistakeStatus } from "@/lib/mistake-status";
import { fetchConfirmBeforeImport, saveParsedQuestion } from "@/lib/question-import";
import type { ImportedQuestion } from "@/lib/question-import";
import { getQuestionSaveErrorMessage } from "@/lib/question-save-error";
import type { AnalyzeResponse, AppConfig } from "@/types/api";
import type { RequestProgress } from "@/lib/request-progress";
import { useImageCropQueue } from "@/lib/use-image-crop-queue";
import { takeRetryImport } from '@/lib/retry-import-transfer';
import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai-timeout';

/** 前台遮罩最多占用页面的时间；请求本身继续在服务端后台执行。 */
const FOREGROUND_DISPLAY_TIMEOUT_MS = 60 * 1000;
const COMPLETED_DISPLAY_MS = 250;

export type ReviewedQuestion = ParsedQuestion & { subjectId?: string; paperLevel?: string };

interface ReanswerResponse {
    gradeSemester?: string | null;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: string;
    difficultyStars?: number | null;
    subject?: string;
}

interface QuestionImportOptions {
    /** 日志前缀，如 [Home] */
    logPrefix: string;
    /** 识别时参考的错题本（决定候选知识点） */
    analyzeSubjectId?: string | null;
    /** 免确认直接入库时放入的错题本 */
    importSubjectId?: string | null;
    /** 文字解题时参考的错题本 */
    textNotebook?: { id: string; name: string };
    /** 校对后保存时固定放入的错题本，不传则使用校对页中选择的错题本 */
    fixedSubjectId?: string;
    /** 图片识别完成、进入校对页之前调用（如按学科自动选择错题本） */
    onParsed?: (data: ParsedQuestion) => void;
}

interface RetryImportPayload {
    parsedData: ParsedQuestion;
    imageBase64: string;
    images?: string[];
    subjectId: string | null;
    confirmBeforeImport: boolean;
}

/**
 * 题目导入流程：裁剪图片 → 压缩 → AI 识别（或文字解题）→ 免确认直接入库，或进入校对页后保存。
 * 首页与错题本的添加错题页共用。
 */
export function useQuestionImport({ logPrefix, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId, onParsed }: QuestionImportOptions) {
    const { t, language } = useLanguage();
    const router = useRouter();
    const onParsedRef = useRef(onParsed);
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [currentImages, setCurrentImages] = useState<string[]>([]);
    const [config, setConfig] = useState<AppConfig | null>(null);
    // 免确认导入：偏好、最近一次导入结果、批量框选的题目图片
    const [confirmBeforeImport, setConfirmBeforeImport] = useState(false);
    const [lastImported, setLastImported] = useState<ImportedQuestion | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [batchBlobs, setBatchBlobs] = useState<Blob[] | null>(null);
    const operationSequenceRef = useRef(0);
    const operationRef = useRef<{ id: number; released: boolean } | null>(null);
    const foregroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const aiTimeout = config?.timeouts?.analyze || DEFAULT_AI_TIMEOUT_MS;
    const safetyTimeout = aiTimeout + 10000;

    const setLocalProgress = useCallback((status: ProgressStatus, percent: number, operationId?: number) => {
        const operation = operationRef.current;
        if (operationId !== undefined && operation?.id !== operationId) return;
        if (operation?.released) return;
        setAnalysisStep(status);
        setAnalysisProgress(percent);
    }, []);

    const beginForegroundOperation = useCallback(() => {
        const id = ++operationSequenceRef.current;
        if (foregroundTimerRef.current) clearTimeout(foregroundTimerRef.current);
        operationRef.current = { id, released: false };
        foregroundTimerRef.current = setTimeout(() => {
            if (operationRef.current?.id !== id) return;
            operationRef.current.released = true;
            setAnalysisStep('idle');
            setAnalysisProgress(0);
            toast.info(t.backgroundTasks.movedToBackground);
            frontendLogger.info(logPrefix, 'Foreground progress released; operation continues in background');
        }, FOREGROUND_DISPLAY_TIMEOUT_MS);
        return id;
    }, [logPrefix, t.backgroundTasks.movedToBackground]);

    const endForegroundOperation = useCallback((operationId: number) => {
        if (operationRef.current?.id !== operationId) return;
        if (foregroundTimerRef.current) clearTimeout(foregroundTimerRef.current);
        foregroundTimerRef.current = null;
        operationRef.current = null;
        setAnalysisStep('idle');
        setAnalysisProgress(0);
    }, []);

    const applyRequestProgress = useCallback((progress: RequestProgress, operationId: number) => {
        setLocalProgress(progress.stage, progress.percent, operationId);
    }, [setLocalProgress]);

    useEffect(() => () => {
        if (foregroundTimerRef.current) clearTimeout(foregroundTimerRef.current);
    }, []);

    useEffect(() => {
        fetchConfirmBeforeImport().then(setConfirmBeforeImport);
        apiClient.get<AppConfig>("/api/settings")
            .then(setConfig)
            .catch(err => frontendLogger.error(logPrefix, 'Failed to fetch config', { error: err }));
    }, [logPrefix]);

    useEffect(() => {
        onParsedRef.current = onParsed;
    }, [onParsed]);

    // 保留按阶段计时的超时兜底，进度估值和已用时间由提示组件统一维护。
    useEffect(() => {
        if (analysisStep === 'idle') return;
        const timeout = setTimeout(() => {
            frontendLogger.warn('[Progress]', '处理超时，关闭进度提示', { analysisStep, safetyTimeout });
            setAnalysisStep('idle');
            setAnalysisProgress(0);
        }, safetyTimeout);
        return () => clearTimeout(timeout);
    }, [analysisStep, safetyTimeout]);

    const startBatch = (blobs: Blob[]) => {
        cropQueue.closeCropper();
        setLastImported(null);
        setSaveError(null);
        setBatchBlobs(blobs);
    };

    /** 识别结果：未开启人工确认时直接入库，否则进入校对页 */
    const handleParsed = useCallback(async (data: AnalyzeResponse, images: string[], paperLevel?: string, confirmOverride = confirmBeforeImport, operationId?: number) => {
        if (!confirmOverride) {
            if ('importedQuestion' in data && data.importedQuestion) {
                const imported = data.importedQuestion;
                setLastImported(imported);
                setCurrentImage(null);
                setCurrentImages([]);
                frontendLogger.info(logPrefix, 'Imported by server without review', { id: imported.id });
                return;
            }
            setLocalProgress('saving', 95, operationId);
            const imported = await saveParsedQuestion(data, { subjectId: importSubjectId, imageUrls: images, paperLevel });
            setLocalProgress('completed', 100, operationId);
            await new Promise((resolve) => setTimeout(resolve, COMPLETED_DISPLAY_MS));
            setLastImported(imported);
            setCurrentImage(null);
            setCurrentImages([]);
            frontendLogger.info(logPrefix, 'Imported without review', { id: imported.id });
            return;
        }
        setLocalProgress('completed', 100, operationId);
        await new Promise((resolve) => setTimeout(resolve, COMPLETED_DISPLAY_MS));
        setCurrentImage(images[0] ?? null);
        setCurrentImages(images);
        setParsedData(data);
        setStep("review");
    }, [confirmBeforeImport, importSubjectId, logPrefix, setLocalProgress]);

    // A retry started from the global task list may need to return to the review editor.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const raw = takeRetryImport();
            if (!raw) return;
            try {
                const payload = JSON.parse(raw) as RetryImportPayload;
                if (!payload?.parsedData || typeof payload.imageBase64 !== 'string') return;
                onParsedRef.current?.(payload.parsedData);
                const images = payload.images?.length ? payload.images : [payload.imageBase64];
                void handleParsed(payload.parsedData, images, undefined, payload.confirmBeforeImport);
            } catch (error) {
                frontendLogger.error(logPrefix, 'Failed to restore retried import', { error });
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [logPrefix, handleParsed]);

    const analyzeBase64 = async (images: string[], existingOperationId?: number) => {
        const startTime = Date.now();
        const operationId = existingOperationId ?? beginForegroundOperation();
        frontendLogger.info(logPrefix, 'Starting analysis flow', { apiTimeout: aiTimeout, safetyTimeout });
        try {
            setLocalProgress('requesting', 15, operationId);
            const returnUrl = new URL(window.location.href);
            if (returnUrl.pathname === '/' && analyzeSubjectId && !returnUrl.searchParams.has('notebook')) {
                returnUrl.searchParams.set('notebook', analyzeSubjectId);
            }
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                ...(images.length > 1 ? { images } : { imageBase64: images[0] }),
                language,
                subjectId: analyzeSubjectId || undefined,
                confirmBeforeImport,
                autoSave: !confirmBeforeImport,
                returnPath: `${returnUrl.pathname}${returnUrl.search}`,
            }, { timeout: aiTimeout, recoverable: true, onProgress: (progress) => applyRequestProgress(progress, operationId) });
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response: data is null or not an object');
            }

            setLocalProgress('collecting', 86, operationId);
            if (confirmBeforeImport) onParsed?.(data);
            await handleParsed(data, images, undefined, confirmBeforeImport, operationId);
            frontendLogger.info(logPrefix, 'Analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            endForegroundOperation(operationId);
        }
    };

    const analyzeImage = async (file: Blob) => {
        const operationId = beginForegroundOperation();
        try {
            setLocalProgress('compressing', 8, operationId);
            const base64Image = await processImageFile(file);
            await analyzeBase64([base64Image], operationId);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image processing failed', { error: getErrorMessage(error) });
            toast.error('图片处理失败');
            endForegroundOperation(operationId);
        }
    };

    const cropComplete = (croppedBlob: Blob) => {
        cropQueue.closeCropper();
        void analyzeImage(croppedBlob);
    };

    const cropQueue = useImageCropQueue({
        logPrefix,
        onComplete: async (images, batch) => {
            if (batch) {
                const blobs = await Promise.all(images.map(async (dataUrl) => (await fetch(dataUrl)).blob()));
                startBatch(blobs);
            } else {
                await analyzeBase64(images);
            }
        },
    });

    const selectImages = (files: File[]) => {
        setLastImported(null);
        setSaveError(null);
        return cropQueue.selectImages(files);
    };

    /** 文字题目由 AI 解答后导入 */
    const submitText = async (questionText: string) => {
        setSaveError(null);
        const operationId = beginForegroundOperation();
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting text-based analysis', { textLength: questionText.length });
        try {
            setLocalProgress('requesting', 15, operationId);
            const result = await apiClient.post<ReanswerResponse>("/api/reanswer", {
                questionText,
                language,
                forImport: true,
                subject: textNotebook?.name,
                subjectId: textNotebook?.id,
            }, { timeout: aiTimeout, recoverable: true, onProgress: (progress) => applyRequestProgress(progress, operationId) });

            setLocalProgress('collecting', 86, operationId);
            await handleParsed({
                questionText,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints || [],
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatus(result.mistakeStatus),
                subject: (result.subject || "其他") as ParsedQuestion["subject"],
                requiresImage: false,
                difficultyStars: result.difficultyStars ?? null,
                gradeSemester: result.gradeSemester ?? null,
            }, [], undefined, confirmBeforeImport, operationId);
            frontendLogger.info(logPrefix, 'Text analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            endForegroundOperation(operationId);
        }
    };

    /** 保存题目；重复题跳到原题，否则跳到所在错题本 */
    const saveQuestion = async (payload: Record<string, unknown> & { subjectId?: string | null }) => {
        setSaveError(null);
        try {
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", payload);
            toast.success(result.duplicate ? t.importFlow.duplicate : t.common.messages.saveSuccess);
            if (result.duplicate) {
                router.push(`/error-items/${result.id}`);
            } else if (payload.subjectId) {
                router.push(`/notebooks/${payload.subjectId}`);
            }
            return true;
        } catch (error) {
            frontendLogger.error(logPrefix, 'Save failed', { errorMessage: getApiErrorMessage(error) ?? getErrorMessage(error) });
            const message = getQuestionSaveErrorMessage(error, t);
            setSaveError(message);
            // 每日额度由 apiClient 统一弹窗提示，此处仍在表单中保留原因。
            if (getApiErrorMessage(error) !== 'AI_DAILY_LIMIT_EXCEEDED') toast.error(message);
            return false;
        }
    };

    /** 校对页保存 */
    const saveReviewed = async (finalData: ReviewedQuestion) => {
        const saved = await saveQuestion({
            ...finalData,
            ...(currentImages.length > 1 ? { originalImageUrls: currentImages } : { originalImageUrl: currentImage || "" }),
            ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}),
        });
        if (saved) {
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
            setCurrentImages([]);
        }
    };

    return {
        step, cancelReview: () => { setStep("upload"); setSaveError(null); },
        saveError, dismissSaveError: () => setSaveError(null),
        analysisStep, analysisProgress, setAnalysisStep, isBusy: analysisStep !== 'idle' || cropQueue.isProcessing,
        parsedData, currentImage, currentImages, aiTimeout,
        croppingImage: cropQueue.croppingImage,
        isCropperOpen: cropQueue.croppingImage !== null,
        cropPosition: cropQueue.cropPosition,
        cropMode: cropQueue.cropMode,
        isCropping: cropQueue.isProcessing,
        closeCropper: cropQueue.closeCropper,
        lastImported, dismissImported: () => setLastImported(null),
        batchBlobs, closeBatch: () => setBatchBlobs(null),
        selectImages, cropComplete, cropRegions: cropQueue.cropRegions, startBatch, submitText, saveQuestion, saveReviewed,
    };
}

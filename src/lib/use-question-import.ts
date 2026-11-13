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
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { ImageRegion } from "@/lib/image-crop";
import type { ImageRotation } from "@/lib/image-crop";
import { normalizeMistakeStatus } from "@/lib/mistake-status";
import { fetchConfirmBeforeImport, saveParsedQuestion } from "@/lib/question-import";
import type { ImportedQuestion } from "@/lib/question-import";
import { getQuestionSaveErrorMessage } from "@/lib/question-save-error";
import type { AnalyzeResponse, AppConfig } from "@/types/api";
import type { RequestProgress } from "@/lib/request-progress";

/** 未配置时 AI 识别的超时（毫秒） */
const DEFAULT_AI_TIMEOUT = 180000;
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

const RETRY_IMPORT_STORAGE_KEY = "background-task-retry-import";

interface RetryImportPayload {
    parsedData: ParsedQuestion;
    imageBase64: string;
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
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    // 免确认导入：偏好、最近一次导入结果、批量框选的题目图片
    const [confirmBeforeImport, setConfirmBeforeImport] = useState(false);
    const [lastImported, setLastImported] = useState<ImportedQuestion | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [batchBlobs, setBatchBlobs] = useState<Blob[] | null>(null);
    const preparedImageRef = useRef<Awaited<ReturnType<typeof prepareImage>> | null>(null);

    const aiTimeout = config?.timeouts?.analyze || DEFAULT_AI_TIMEOUT;
    const safetyTimeout = aiTimeout + 10000;

    const applyRequestProgress = (progress: RequestProgress) => {
        setAnalysisStep(progress.stage);
        setAnalysisProgress(progress.percent);
    };

    const setLocalProgress = useCallback((status: ProgressStatus, percent: number) => {
        setAnalysisStep(status);
        setAnalysisProgress(percent);
    }, []);

    // Keep the decoded source alive while the cropper is open, then release it.
    useEffect(() => () => preparedImageRef.current?.dispose(), []);

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

    const selectImage = async (file: File) => {
        setLastImported(null);
        setSaveError(null);
        try {
            const prepared = await prepareImage(file);
            preparedImageRef.current?.dispose();
            preparedImageRef.current = prepared;
            setCroppingImage(prepared.previewUrl);
            setIsCropperOpen(true);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image preparation failed', { error: getErrorMessage(error) });
            const code = error instanceof ImageDecodeError ? error.code : '';
            toast.error(code === 'HEIC_DECODE_FAILED' ? 'HEIC 图片解码失败' : '图片读取失败');
        }
    };

    const startBatch = (blobs: Blob[]) => {
        preparedImageRef.current?.dispose();
        preparedImageRef.current = null;
        setIsCropperOpen(false);
        setCroppingImage(null);
        setLastImported(null);
        setSaveError(null);
        setBatchBlobs(blobs);
    };

    /** 识别结果：未开启人工确认时直接入库，否则进入校对页 */
    const handleParsed = useCallback(async (data: ParsedQuestion, imageUrl: string | null, paperLevel?: string, confirmOverride = confirmBeforeImport) => {
        if (!confirmOverride) {
            setLocalProgress('saving', 95);
            const imported = await saveParsedQuestion(data, { subjectId: importSubjectId, imageUrl, paperLevel });
            setLocalProgress('completed', 100);
            await new Promise((resolve) => setTimeout(resolve, COMPLETED_DISPLAY_MS));
            setLastImported(imported);
            setCurrentImage(null);
            frontendLogger.info(logPrefix, 'Imported without review', { id: imported.id });
            return;
        }
        setLocalProgress('completed', 100);
        await new Promise((resolve) => setTimeout(resolve, COMPLETED_DISPLAY_MS));
        setCurrentImage(imageUrl);
        setParsedData(data);
        setStep("review");
    }, [confirmBeforeImport, importSubjectId, logPrefix, setLocalProgress]);

    // A retry started from the global task list may need to return to the review editor.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            let raw: string | null = null;
            try {
                raw = sessionStorage.getItem(RETRY_IMPORT_STORAGE_KEY);
                if (raw) sessionStorage.removeItem(RETRY_IMPORT_STORAGE_KEY);
            } catch {
                return;
            }
            if (!raw) return;
            try {
                const payload = JSON.parse(raw) as RetryImportPayload;
                if (!payload?.parsedData || typeof payload.imageBase64 !== 'string') return;
                onParsedRef.current?.(payload.parsedData);
                void handleParsed(payload.parsedData, payload.imageBase64, undefined, payload.confirmBeforeImport);
            } catch (error) {
                frontendLogger.error(logPrefix, 'Failed to restore retried import', { error });
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [logPrefix, handleParsed]);

    const analyzeBase64 = async (base64Image: string) => {
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting analysis flow', { apiTimeout: aiTimeout, safetyTimeout });
        try {
            setLocalProgress('requesting', 15);
            const returnUrl = new URL(window.location.href);
            if (returnUrl.pathname === '/' && analyzeSubjectId && !returnUrl.searchParams.has('notebook')) {
                returnUrl.searchParams.set('notebook', analyzeSubjectId);
            }
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language,
                subjectId: analyzeSubjectId || undefined,
                confirmBeforeImport,
                returnPath: `${returnUrl.pathname}${returnUrl.search}`,
            }, { timeout: aiTimeout, recoverable: true, onProgress: applyRequestProgress });
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response: data is null or not an object');
            }

            setLocalProgress('collecting', 86);
            if (confirmBeforeImport) onParsed?.(data);
            await handleParsed(data, base64Image);
            frontendLogger.info(logPrefix, 'Analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
            setAnalysisProgress(0);
        }
    };

    const analyzeImage = async (file: Blob) => {
        try {
            setLocalProgress('compressing', 8);
            const base64Image = await processImageFile(file);
            await analyzeBase64(base64Image);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image processing failed', { error: getErrorMessage(error) });
            toast.error('图片处理失败');
            setAnalysisStep('idle');
            setAnalysisProgress(0);
        }
    };

    const cropComplete = (croppedBlob: Blob) => {
        preparedImageRef.current?.dispose();
        preparedImageRef.current = null;
        setIsCropperOpen(false);
        setCroppingImage(null);
        void analyzeImage(croppedBlob);
    };

    const cropRegions = async (regions: ImageRegion[], multi: boolean, rotation: ImageRotation = 0) => {
        const prepared = preparedImageRef.current;
        if (!prepared || regions.length === 0) return;
        setIsCropperOpen(false);
        setLocalProgress('compressing', 8);
        try {
            const rendered = await Promise.all(regions.map((region) => renderRegion(prepared, region, rotation)));
            const dataUrls = rendered.map((image) => image.dataUrl);
            prepared.dispose();
            preparedImageRef.current = null;
            setCroppingImage(null);
            if (multi) {
                const blobs = await Promise.all(dataUrls.map(async (dataUrl) => (await fetch(dataUrl)).blob()));
                setBatchBlobs(blobs);
                return;
            }
            await analyzeBase64(dataUrls[0]);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image crop failed', { error: getErrorMessage(error) });
            toast.error('图片处理失败');
        } finally {
            setAnalysisStep('idle');
            setAnalysisProgress(0);
        }
    };

    /** 文字题目由 AI 解答后导入 */
    const submitText = async (questionText: string) => {
        setSaveError(null);
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting text-based analysis', { textLength: questionText.length });
        try {
            setLocalProgress('requesting', 15);
            const result = await apiClient.post<ReanswerResponse>("/api/reanswer", {
                questionText,
                language,
                forImport: true,
                subject: textNotebook?.name,
                subjectId: textNotebook?.id,
            }, { timeout: aiTimeout, recoverable: true, onProgress: applyRequestProgress });

            setLocalProgress('collecting', 86);
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
            }, null);
            frontendLogger.info(logPrefix, 'Text analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
            setAnalysisProgress(0);
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
            originalImageUrl: currentImage || "",
            ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}),
        });
        if (saved) {
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
        }
    };

    return {
        step, cancelReview: () => { setStep("upload"); setSaveError(null); },
        saveError, dismissSaveError: () => setSaveError(null),
        analysisStep, analysisProgress, setAnalysisStep, isBusy: analysisStep !== 'idle',
        parsedData, currentImage, aiTimeout,
        croppingImage,
        isCropperOpen,
        closeCropper: () => {
            preparedImageRef.current?.dispose();
            preparedImageRef.current = null;
            setCroppingImage(null);
            setIsCropperOpen(false);
        },
        lastImported, dismissImported: () => setLastImported(null),
        batchBlobs, closeBatch: () => setBatchBlobs(null),
        selectImage, cropComplete, cropRegions, startBatch, submitText, saveQuestion, saveReviewed,
    };
}

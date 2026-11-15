"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { ImageRegion, ImageRotation } from "@/lib/image-crop";
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";

interface ImageCropQueueOptions {
    logPrefix: string;
    onComplete: (images: string[], batch: boolean) => Promise<void>;
}

/** 按顺序裁剪所选图片，只保留当前原图，全部确认后再开始导入。 */
export function useImageCropQueue({ logPrefix, onComplete }: ImageCropQueueOptions) {
    const { t } = useLanguage();
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [cropPosition, setCropPosition] = useState({ current: 0, total: 0 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [cropMode, setCropMode] = useState<"single" | "multi">("single");
    const preparedRef = useRef<PreparedImage | null>(null);
    const filesRef = useRef<File[]>([]);
    const resultsRef = useRef<string[]>([]);
    const indexRef = useRef(0);
    const batchRef = useRef(false);
    const generationRef = useRef(0);
    const processingRef = useRef(false);

    useEffect(() => () => {
        generationRef.current++;
        preparedRef.current?.dispose();
        preparedRef.current = null;
    }, []);

    const closeCropper = () => {
        generationRef.current++;
        preparedRef.current?.dispose();
        preparedRef.current = null;
        filesRef.current = [];
        resultsRef.current = [];
        indexRef.current = 0;
        batchRef.current = false;
        processingRef.current = false;
        setCroppingImage(null);
        setCropPosition({ current: 0, total: 0 });
        setIsProcessing(false);
        setCropMode("single");
    };

    const showError = (error: unknown) => {
        frontendLogger.error(logPrefix, "Image crop failed", { error: getErrorMessage(error) });
        toast.error(error instanceof ImageDecodeError && error.code === "HEIC_DECODE_FAILED"
            ? t.common.cropper.heicReadFailed
            : t.common.cropper.imageProcessFailed);
    };

    const selectImages = async (files: File[]) => {
        if (files.length === 0) return;
        closeCropper();
        const generation = generationRef.current;
        filesRef.current = [...files];
        processingRef.current = true;
        setIsProcessing(true);
        try {
            const prepared = await prepareImage(files[0]);
            if (generation !== generationRef.current) {
                prepared.dispose();
                return;
            }
            preparedRef.current = prepared;
            setCroppingImage(prepared.previewUrl);
            setCropPosition({ current: 1, total: files.length });
        } catch (error) {
            if (generation !== generationRef.current) return;
            closeCropper();
            showError(error);
        } finally {
            if (generation === generationRef.current) {
                processingRef.current = false;
                setIsProcessing(false);
            }
        }
    };

    const cropRegions = async (regions: ImageRegion[], multi: boolean, rotation: ImageRotation = 0) => {
        const prepared = preparedRef.current;
        if (!prepared || regions.length === 0 || processingRef.current) return;
        const generation = generationRef.current;
        processingRef.current = true;
        setIsProcessing(true);
        try {
            const images: string[] = [];
            for (const region of regions) {
                const { dataUrl } = await renderRegion(prepared, region, rotation);
                if (generation !== generationRef.current) return;
                images.push(dataUrl);
            }
            const results = [...resultsRef.current, ...images];
            // 图片数量与题目数量无关，本次导入模式由首张图片的显式选择决定。
            const batch = indexRef.current === 0 ? multi : batchRef.current;
            const nextIndex = indexRef.current + 1;
            const nextFile = filesRef.current[nextIndex];
            if (nextFile) {
                // 下一张读取失败时保留当前图与已有结果，重试不会漏图或重复追加。
                const next = await prepareImage(nextFile);
                if (generation !== generationRef.current) {
                    next.dispose();
                    return;
                }
                prepared.dispose();
                preparedRef.current = next;
                resultsRef.current = results;
                batchRef.current = batch;
                setCropMode(batch ? "multi" : "single");
                indexRef.current = nextIndex;
                setCroppingImage(next.previewUrl);
                setCropPosition({ current: nextIndex + 1, total: filesRef.current.length });
            } else {
                closeCropper();
                await onComplete(results, batch).catch(showError);
            }
        } catch (error) {
            if (generation === generationRef.current) showError(error);
        } finally {
            if (generation === generationRef.current) {
                processingRef.current = false;
                setIsProcessing(false);
            }
        }
    };

    return { croppingImage, cropPosition, cropMode, isProcessing, selectImages, cropRegions, closeCropper };
}

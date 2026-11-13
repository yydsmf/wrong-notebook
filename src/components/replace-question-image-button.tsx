"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/image-cropper";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { ImageRegion, ImageRotation } from "@/lib/image-crop";
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";
import { toast, confirmDialog } from "@/lib/feedback";

interface ReplaceQuestionImageButtonProps {
    errorItemId: string;
    /** 题目已有原图时替换前二次确认 */
    hasImage: boolean;
    onDone: (originalImageUrl: string) => void;
}

/** 替换原题图片：先按原图方向解码，再从原图裁剪并按统一限制编码。 */
export function ReplaceQuestionImageButton({ errorItemId, hasImage, onDone }: ReplaceQuestionImageButtonProps) {
    const { t } = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [prepared, setPrepared] = useState<PreparedImage | null>(null);

    useEffect(() => () => prepared?.dispose(), [prepared]);

    const handleClick = async () => {
        if (hasImage && !(await confirmDialog(t.replaceImage.confirm))) return;
        inputRef.current?.click();
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const next = await prepareImage(file);
            setPrepared(next);
        } catch (error) {
            frontendLogger.warn('[ReplaceImage]', 'Image preparation failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            toast.error(error instanceof ImageDecodeError && error.code === 'HEIC_DECODE_FAILED'
                ? 'HEIC 图片解码失败'
                : t.replaceImage.invalid);
        } finally {
            setUploading(false);
        }
    };

    const handleRegions = async (regions: ImageRegion[], rotation: ImageRotation) => {
        const source = prepared;
        if (!source || regions.length === 0) return;
        setUploading(true);
        try {
            const { dataUrl: imageDataUrl } = await renderRegion(source, regions[0], rotation);
            setPrepared(null);
            const result = await apiClient.put<{ originalImageUrl: string }>(`/api/error-items/${errorItemId}/image`, { imageDataUrl });
            onDone(result.originalImageUrl);
            toast.success(t.replaceImage.done);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            frontendLogger.error('[ReplaceImage]', 'Failed to replace original image', { code });
            toast.error(code === "INVALID_IMAGE" ? t.replaceImage.invalid : t.replaceImage.failed);
        } finally {
            setUploading(false);
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.target.value = "";
                }}
            />
            {prepared && (
                <ImageCropper
                    key={prepared.previewUrl}
                    imageSrc={prepared.previewUrl}
                    open={!uploading}
                    onClose={() => setPrepared(null)}
                    onRegionsSelected={(regions, _multi, rotation) => void handleRegions(regions, rotation)}
                />
            )}
            <Button variant="outline" size="sm" onClick={handleClick} disabled={uploading} className="flex items-center gap-2">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? t.replaceImage.uploading : hasImage ? t.replaceImage.replace : t.replaceImage.add}
            </Button>
        </>
    );
}

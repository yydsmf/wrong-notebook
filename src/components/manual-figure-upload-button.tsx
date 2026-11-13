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
import { toast } from "@/lib/feedback";

interface ManualFigureUploadButtonProps {
    errorItemId: string;
    onDone: (imageFragments: string | null) => void;
}

/** 用户本地裁剪并追加一张原图配图；可反复点击追加多张，不调用 AI。 */
export function ManualFigureUploadButton({ errorItemId, onDone }: ManualFigureUploadButtonProps) {
    const { t } = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const [saving, setSaving] = useState(false);
    const [prepared, setPrepared] = useState<PreparedImage | null>(null);

    useEffect(() => () => prepared?.dispose(), [prepared]);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setSaving(true);
        try {
            setPrepared(await prepareImage(file));
        } catch (error) {
            frontendLogger.warn("[ManualFigureUpload]", "Image preparation failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            toast.error(error instanceof ImageDecodeError && error.code === "HEIC_DECODE_FAILED"
                ? "HEIC 图片解码失败"
                : t.figure.manualInvalid);
        } finally {
            setSaving(false);
        }
    };

    const handleRegions = async (regions: ImageRegion[], rotation: ImageRotation) => {
        const source = prepared;
        if (!source || regions.length === 0) return;
        setSaving(true);
        try {
            let imageFragments: string | null = null;
            for (const region of regions) {
                const { dataUrl } = await renderRegion(source, region, rotation);
                const result = await apiClient.post<{ imageFragments: string | null }>(
                    `/api/error-items/${errorItemId}/figure-images`,
                    { imageDataUrl: dataUrl },
                );
                imageFragments = result.imageFragments;
            }
            setPrepared(null);
            onDone(imageFragments);
            toast.success(regions.length > 1 ? t.figure.manualBatchDone.replace("{count}", String(regions.length)) : t.figure.manualDone);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            frontendLogger.error("[ManualFigureUpload]", "Failed to save figure image", { code, error });
            toast.error(code || t.figure.manualFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                    void handleFile(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
            {prepared && (
                <ImageCropper
                    key={prepared.previewUrl}
                    imageSrc={prepared.previewUrl}
                    open={!saving}
                    onClose={() => setPrepared(null)}
                    enableMultiCrop
                    onRegionsSelected={(regions, _multi, rotation) => void handleRegions(regions, rotation)}
                />
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={saving}
                className="flex items-center gap-2"
            >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {saving ? t.figure.manualUploading : t.figure.manualUpload}
            </Button>
        </>
    );
}

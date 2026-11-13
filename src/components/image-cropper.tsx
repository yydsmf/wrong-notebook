"use client";

import { useEffect, useState, useRef } from "react";
import type { CSSProperties } from "react";
import ReactCrop from "react-image-crop";
import type { Crop } from "react-image-crop";
import { RefreshCcw, RotateCcw, RotateCw } from "lucide-react";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RegionSelector } from "@/components/region-selector";
import { ZoomControls } from "@/components/zoom-controls";
import { useLanguage } from "@/contexts/LanguageContext";
import { createRotatedImagePreview, cropImageRegions, normalizeImageRotation, toSafeImageSrc } from "@/lib/image-crop";
import type { ImageRegion, ImageRotation } from "@/lib/image-crop";
import { frontendLogger } from "@/lib/frontend-logger";
import { useImageZoom } from "@/lib/use-image-zoom";

// 未缩放时图片适应弹窗的尺寸
const FIT_STYLE: Record<"single" | "multi", CSSProperties> = {
    single: { maxHeight: "70vh", maxWidth: "100%", objectFit: "contain" },
    multi: { maxHeight: "65vh", maxWidth: "100%", objectFit: "contain" },
};

interface ImageCropperProps {
    imageSrc: string;
    open: boolean;
    onClose: () => void;
    onCropComplete?: (croppedImageBlob: Blob) => void;
    /** 提供时显示「多题框选」模式，返回每个框裁剪出的图片 */
    onMultiCropComplete?: (croppedImageBlobs: Blob[]) => void;
    /** 提供时只返回相对坐标，由调用方从已解码的原图裁剪 */
    onRegionsSelected?: (regions: ImageRegion[], multi: boolean, rotation: ImageRotation) => void;
    /** 显示多区域框选模式；结果仍由 onRegionsSelected 返回给调用方处理。 */
    enableMultiCrop?: boolean;
}

export function ImageCropper({ imageSrc, open, onClose, onCropComplete, onMultiCropComplete, onRegionsSelected, enableMultiCrop = false }: ImageCropperProps) {
    const { t } = useLanguage();
    const [rotation, setRotation] = useState<ImageRotation>(0);
    const [displayImageSrc, setDisplayImageSrc] = useState(imageSrc);
    const generatedPreviewRef = useRef<string | null>(null);
    const safeImageSrc = toSafeImageSrc(displayImageSrc);
    // 始终保存百分比坐标，缩放改变图片显示尺寸后仍然准确
    const [crop, setCrop] = useState<Crop>();
    const imgRef = useRef<HTMLImageElement>(null);
    const [mode, setModeState] = useState<"single" | "multi">("single");
    const { containerRef, zoom, imageStyle, measureImage, zoomIn, zoomOut, reset: resetZoom } = useImageZoom(FIT_STYLE[mode]);
    // 换图后回到 100%
    useEffect(() => {
        resetZoom();
    }, [imageSrc, resetZoom]);
    const setMode = (next: "single" | "multi") => {
        resetZoom();
        setModeState(next);
    };
    // 框选结果与图片绑定，换图后自动清空
    const [regionState, setRegionState] = useState<{ src: string; regions: ImageRegion[] }>({ src: imageSrc, regions: [] });
    const regions = regionState.src === displayImageSrc ? regionState.regions : [];
    const setRegions = (next: ImageRegion[]) => setRegionState({ src: displayImageSrc, regions: next });
    const multiImgRef = useRef<HTMLImageElement>(null);

    const releaseGeneratedPreview = () => {
        if (generatedPreviewRef.current) {
            URL.revokeObjectURL(generatedPreviewRef.current);
            generatedPreviewRef.current = null;
        }
    };

    useEffect(() => () => releaseGeneratedPreview(), [imageSrc]);

    useEffect(() => {
        let active = true;
        releaseGeneratedPreview();
        if (rotation === 0) {
            return () => {
                active = false;
            };
        }

        void createRotatedImagePreview(imageSrc, rotation).then((url) => {
            if (!active) {
                URL.revokeObjectURL(url);
                return;
            }
            generatedPreviewRef.current = url;
            setDisplayImageSrc(url);
            setRegionState({ src: url, regions: [] });
        }).catch((error) => {
            frontendLogger.error('[ImageCropper]', 'Rotation preview failed', { error });
            if (active) setDisplayImageSrc(imageSrc);
        });

        return () => {
            active = false;
        };
    }, [imageSrc, rotation]);

    useEffect(() => () => releaseGeneratedPreview(), []);

    const rotate = (delta: number) => {
        const next = normalizeImageRotation(rotation + delta);
        setRotation(next);
        if (next === 0) {
            setDisplayImageSrc(imageSrc);
            setRegionState({ src: imageSrc, regions: [] });
        }
        resetZoom();
    };

    const handleMultiConfirm = async () => {
        if (regions.length === 0) return;
        if (onRegionsSelected) {
            onRegionsSelected(regions, true, rotation);
            setRegions([]);
            return;
        }
        if (!multiImgRef.current || !onMultiCropComplete) return;
        try {
            onMultiCropComplete(await cropImageRegions(multiImgRef.current, regions));
            setRegions([]);
        } catch (e) {
            frontendLogger.error('[ImageCropper]', 'Multi-image crop failed', { error: e });
        }
    };

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        // 默认框选整张图片，不拖动直接确认即为整图
        setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
        measureImage(e.currentTarget);
    }

    const handleConfirm = async () => {
        if (!imgRef.current) return;
        // 没有有效选框（如只点了一下）时使用整张图片
        const region: ImageRegion = crop && crop.width > 0 && crop.height > 0
            ? { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 }
            : { x: 0, y: 0, width: 1, height: 1 };
        try {
            if (onRegionsSelected) {
                onRegionsSelected([region], false, rotation);
                return;
            }
            const [croppedBlob] = await cropImageRegions(imgRef.current, [region]);
            onCropComplete?.(croppedBlob);
        } catch (e) {
            frontendLogger.error('[ImageCropper]', 'Crop failed', { error: e });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b shrink-0">
                    <DialogTitle>{t.common.cropper?.title || "Crop Image"}</DialogTitle>
                </DialogHeader>

                <div className="relative min-h-0 flex-1 bg-black">
                    {/* m-auto 居中：图片放大超出容器后仍能滚动到左上角 */}
                    <div ref={containerRef} className="flex h-full w-full overflow-auto p-4">
                        <div className="m-auto">
                            {mode === "multi" ? (
                                <RegionSelector
                                    ref={multiImgRef}
                                    imageSrc={safeImageSrc}
                                    regions={regions}
                                    onChange={setRegions}
                                    imageStyle={imageStyle}
                                    onImageLoad={(e) => measureImage(e.currentTarget)}
                                />
                            ) : (
                                <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)}>
                                    <img
                                        ref={imgRef}
                                        alt="Crop me"
                                        src={safeImageSrc}
                                        onLoad={onImageLoad}
                                        style={imageStyle}
                                    />
                                </ReactCrop>
                            )}
                        </div>
                    </div>
                    <div className="absolute right-3 top-3 flex items-center gap-2">
                        <div className="flex items-center gap-0.5 rounded-full bg-black/60 p-1 shadow-lg backdrop-blur-sm">
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                onClick={() => rotate(-90)}
                                aria-label={t.common.cropper.rotateLeft}
                                title={t.common.cropper.rotateLeft}
                            >
                                <RotateCcw className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                onClick={() => rotate(90)}
                                aria-label={t.common.cropper.rotateRight}
                                title={t.common.cropper.rotateRight}
                            >
                                <RotateCw className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                onClick={() => rotate(-rotation)}
                                disabled={rotation === 0}
                                aria-label={t.common.cropper.resetRotation}
                                title={t.common.cropper.resetRotation}
                            >
                                <RefreshCcw className="h-4 w-4" />
                            </button>
                        </div>
                        <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
                    </div>
                </div>

                <div className="p-4 border-t bg-background shrink-0 space-y-3">
                    {(onMultiCropComplete || enableMultiCrop) && (
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:w-80">
                            {(["single", "multi"] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setMode(value)}
                                    className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${mode === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                                >
                                    {value === "single" ? t.batchImport.singleMode : t.batchImport.multiMode}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                        <p className="text-sm text-muted-foreground">
                            {mode === "multi"
                                ? `${t.batchImport.hint} ${t.batchImport.regionCount.replace("{count}", String(regions.length))}`
                                : (t.common.cropper?.hint || "💡 Drag to adjust crop area")}
                        </p>
                        <div className="flex gap-2 justify-end">
                            {mode === "multi" && regions.length > 0 && (
                                <Button variant="ghost" onClick={() => setRegions([])}>
                                    {t.batchImport.clear}
                                </Button>
                            )}
                            <Button variant="outline" onClick={onClose}>
                                {t.common.cancel || "Cancel"}
                            </Button>
                            {mode === "multi" ? (
                                <Button onClick={handleMultiConfirm} disabled={regions.length === 0}>
                                    {t.batchImport.start.replace("{count}", String(regions.length))}
                                </Button>
                            ) : (
                                <Button onClick={handleConfirm}>
                                    {t.common.confirm || "Confirm"}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

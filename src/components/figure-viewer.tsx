"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Scan, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { ZoomControls } from "@/components/zoom-controls";
import { useLanguage } from "@/contexts/LanguageContext";
import { getFigureReadingSize } from "@/lib/figure-reading";
import { useImageZoom } from "@/lib/use-image-zoom";

interface FigureViewerProps {
    src: string;
    svg?: string;
    onClose: () => void;
    onReturnFocus: () => void;
}

/** 配图查看器：密集表格和几何标注可在移动端放大阅读。 */
export function FigureViewer({ src, svg, onClose, onReturnFocus }: FigureViewerProps) {
    const { t } = useLanguage();
    const [readingSize, setReadingSize] = useState<{ src: string; svg: string; width: number } | null>(null);
    const [overview, setOverview] = useState(false);
    const readingWidth = readingSize?.src === src && readingSize.svg === svg ? readingSize.width : null;
    const displayWidth = overview ? null : readingWidth;
    const { containerRef, zoom, imageStyle, measureImage, zoomIn, zoomOut, reset } = useImageZoom({
        maxHeight: displayWidth ? "none" : "calc(90dvh - 9rem)",
        maxWidth: displayWidth ? "none" : "100%",
        width: displayWidth ?? "auto",
        objectFit: "contain",
    });
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogPortal>
                <DialogOverlay className="print:hidden" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    className="fixed left-1/2 top-1/2 z-50 flex h-[90dvh] w-[calc(100%-1rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-card shadow-xl sm:w-[calc(100%-2rem)] print:hidden"
                    onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}
                >
                    <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
                        <DialogTitle className="text-base">{t.figure.alt}</DialogTitle>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label={t.common.close} title={t.common.close}>
                                <X className="h-4 w-4" />
                            </Button>
                        </DialogClose>
                    </div>
                    <div ref={containerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/30 p-3" tabIndex={0} role="region" aria-label={t.figure.alt}>
                        <img
                            src={src}
                            alt={t.figure.alt}
                            className="mx-auto block h-auto rounded bg-white object-contain"
                            style={imageStyle}
                            onLoad={(event) => {
                                const image = event.currentTarget;
                                const size = svg ? getFigureReadingSize(svg, image.naturalWidth, image.naturalHeight) : null;
                                setReadingSize((previous) => size && svg
                                    ? previous?.src === src && previous.svg === svg && previous.width === size.width ? previous : { src, svg, width: size.width }
                                    : previous === null ? previous : null);
                                measureImage(image);
                            }}
                        />
                    </div>
                    <div className="flex shrink-0 items-center justify-center gap-2 border-t p-2">
                        {readingWidth && (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label={overview ? t.figure.readingSize : t.figure.fitWhole}
                                title={overview ? t.figure.readingSize : t.figure.fitWhole}
                                onClick={() => { setOverview((previous) => !previous); reset(); }}
                            >
                                {overview ? <ScanText className="h-4 w-4" /> : <Scan className="h-4 w-4" />}
                            </Button>
                        )}
                        <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} />
                    </div>
                </DialogPrimitive.Content>
            </DialogPortal>
        </Dialog>
    );
}

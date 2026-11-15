"use client";

import { useRef, useState } from "react";
import { Loader2, Maximize2, X } from "lucide-react";
import { FigureViewer } from "@/components/figure-viewer";
import { useLanguage } from "@/contexts/LanguageContext";
import { figureSvgToDataUri } from "@/lib/figure-svg";
import { getFigureReadingSize } from "@/lib/figure-reading";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";
import type { ImageFragment } from "@/lib/image-fragments";
import { cn } from "@/lib/utils";

interface QuestionFigureProps {
    svg?: string | null;
    images?: ImageFragment[];
    scale?: number;
    align?: FigureAlign | string | null;
    className?: string;
    onRemoveImage?: (id: string) => void | Promise<void>;
}

const ALIGN_CLASS: Record<FigureAlign, string> = {
    left: "mr-auto",
    center: "mx-auto",
    right: "ml-auto",
};

/**
 * 题目的 SVG 配图。用 <img> 加载 data URI，SVG 中即使有脚本也不会执行；
 * 固定白色背景，深色模式和打印时黑色线条都清晰可见。
 */
export function QuestionFigure({ svg, images = [], scale, align, className, onRemoveImage }: QuestionFigureProps) {
    const { t } = useLanguage();
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [preview, setPreview] = useState<{ src: string; svg?: string } | null>(null);
    const [readingSize, setReadingSize] = useState<{ svg: string; width: number } | null>(null);
    const previewTrigger = useRef<HTMLButtonElement | null>(null);
    if (!svg && images.length === 0) return null;
    const figureScale = normalizeFigureScale(scale);
    const figureAlign = normalizeFigureAlign(align);
    const alignMargin = figureAlign === "left"
        ? { marginLeft: 0, marginRight: "auto" }
        : figureAlign === "right"
            ? { marginLeft: "auto", marginRight: 0 }
            : {};

    const imageStyle = {
        ...alignMargin,
        maxHeight: 360,
        zoom: figureScale / 100,
        maxWidth: "100%",
    };
    const frameStyle = { maxWidth: `${Math.min(figureScale, 100)}%` };
    const reading = readingSize?.svg === svg ? readingSize : null;

    const removeImage = async (id: string) => {
        if (!onRemoveImage || removingId) return;
        setRemovingId(id);
        try {
            await onRemoveImage(id);
        } finally {
            setRemovingId(null);
        }
    };

    const previewButton = (src: string, markup?: string) => (
        <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t.figure.viewLarge}
            title={t.figure.viewLarge}
            onClick={(event) => { previewTrigger.current = event.currentTarget; setPreview({ src, svg: markup }); }}
        >
            <Maximize2 className="h-4 w-4" />
        </button>
    );

    const svgImage = svg ? (
        <img
            src={figureSvgToDataUri(svg)}
            alt={t.figure.alt}
            className={cn("block h-auto max-w-full rounded border bg-white p-2", reading && "figure-readable-image")}
            style={reading ? { ...imageStyle, width: `calc(${reading.width}px + 1rem + 2px)`, maxWidth: "none", maxHeight: "none" } : imageStyle}
            onLoad={(event) => {
                const image = event.currentTarget;
                const size = getFigureReadingSize(svg, image.naturalWidth, image.naturalHeight);
                setReadingSize((previous) => size
                    ? previous?.svg === svg && previous.width === size.width ? previous : { svg, width: size.width }
                    : previous === null ? previous : null);
            }}
        />
    ) : null;

    return (
        <figure className={cn("question-figure my-3 space-y-3", className)}>
            {images.length > 0 ? images.map((image) => (
                <div key={image.id} className={cn("relative w-fit max-w-full", ALIGN_CLASS[figureAlign])} style={frameStyle}>
                    <div className="flex items-center justify-end gap-1 pb-1 print:hidden">
                        {previewButton(image.imageUrl)}
                        {onRemoveImage && (
                        <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow hover:bg-black/80 disabled:opacity-50"
                            aria-label={t.figure.removeManual}
                            title={t.figure.removeManual}
                            disabled={removingId !== null}
                            onClick={() => void removeImage(image.id)}
                        >
                            {removingId === image.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </button>
                        )}
                    </div>
                    <img
                        src={image.imageUrl}
                        alt={t.figure.alt}
                        className={cn(ALIGN_CLASS[figureAlign], "block h-auto max-w-full rounded border bg-white p-2")}
                        style={imageStyle}
                    />
                </div>
            )) : (
                <div className={cn("relative w-fit max-w-full", ALIGN_CLASS[figureAlign])} style={frameStyle}>
                    <div className="flex justify-end pb-1 print:hidden">{previewButton(figureSvgToDataUri(svg!), svg!)}</div>
                    {reading ? (
                        <div className="figure-reading-region max-w-full overflow-auto overscroll-x-contain" style={{ maxHeight: "min(70dvh, 720px)" }} tabIndex={0} role="region" aria-label={t.figure.alt}>
                            {svgImage}
                        </div>
                    ) : svgImage}
                </div>
            )}
            {preview && <FigureViewer key={preview.src} src={preview.src} svg={preview.svg} onClose={() => setPreview(null)} onReturnFocus={() => previewTrigger.current?.focus()} />}
        </figure>
    );
}

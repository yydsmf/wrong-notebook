"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { figureSvgToDataUri } from "@/lib/figure-svg";
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
        maxWidth: `${Math.min(figureScale, 100)}%`,
    };

    const removeImage = async (id: string) => {
        if (!onRemoveImage || removingId) return;
        setRemovingId(id);
        try {
            await onRemoveImage(id);
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <figure className={cn("question-figure my-3 space-y-3", className)}>
            {images.length > 0 ? images.map((image) => (
                <div key={image.id} className="relative w-fit max-w-full">
                    <img
                        src={image.imageUrl}
                        alt={t.figure.alt}
                        className={cn(ALIGN_CLASS[figureAlign], "block h-auto max-w-full rounded border bg-white p-2")}
                        style={imageStyle}
                    />
                    {onRemoveImage && (
                        <button
                            type="button"
                            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white shadow hover:bg-black/80 disabled:opacity-50 print:hidden"
                            aria-label={t.figure.removeManual}
                            title={t.figure.removeManual}
                            disabled={removingId !== null}
                            onClick={() => void removeImage(image.id)}
                        >
                            {removingId === image.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </button>
                    )}
                </div>
            )) : (
                <img
                    src={figureSvgToDataUri(svg!)}
                    alt={t.figure.alt}
                    className={cn(ALIGN_CLASS[figureAlign], "block h-auto max-w-full rounded border bg-white p-2")}
                    // zoom 同时改变显示尺寸和布局占位，打印时也生效；宽图缩小时同步收紧宽度上限。
                    style={imageStyle}
                />
            )}
        </figure>
    );
}

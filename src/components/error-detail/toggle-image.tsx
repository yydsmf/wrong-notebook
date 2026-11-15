"use client";

import type { ReactNode } from "react";
import { EyeOff, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface ToggleImageProps {
    src?: string | null;
    sources?: string[];
    alt: string;
    showLabel: string;
    hideLabel: string;
    visible: boolean;
    onVisibleChange: (visible: boolean) => void;
    onEnlarge: (src: string) => void;
    variant?: "outline" | "ghost";
    /** 与显示按钮并排的其他按钮 */
    actions?: ReactNode;
}

/** 默认折叠的图片：点击按钮显示，点击图片放大 */
export function ToggleImage({ src, sources, alt, showLabel, hideLabel, visible, onVisibleChange, onEnlarge, variant = "ghost", actions }: ToggleImageProps) {
    const { t } = useLanguage();
    const images = sources?.length ? sources : src ? [src] : [];

    return (
        <>
            <div className="flex flex-wrap gap-2">
                {images.length > 0 && (
                    <Button variant={variant} size="sm" onClick={() => onVisibleChange(!visible)} className={`flex items-center gap-2 ${variant === "ghost" ? "text-muted-foreground" : ""}`}>
                        {visible ? <><EyeOff className="h-4 w-4" />{hideLabel}</> : <><ImageIcon className="h-4 w-4" />{showLabel}</>}
                    </Button>
                )}
                {actions}
            </div>
            {images.length > 0 && visible && (
                <div className="mt-4 space-y-3">
                    {images.map((source, index) => <img key={index} src={source} alt={`${alt}${images.length > 1 ? ` ${index + 1}` : ''}`} className="w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity" onClick={() => onEnlarge(source)} />)}
                    <p className="text-xs text-muted-foreground mt-1 text-center">{t.detail?.clickToEnlarge || "Click to enlarge"}</p>
                </div>
            )}
        </>
    );
}

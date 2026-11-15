export interface FigurePanelSize {
    width: number;
    height: number;
    minimumFontSize?: number;
}

export interface FigureGroupLayout {
    width: number;
    height: number;
    scale: number;
    panels: Array<{ x: number; y: number; width: number; height: number; labelX: number; labelY: number }>;
}

/** 子图共用一个缩放比例；密集内容改为单列，仍装不下则整组回退。 */
export function layoutFigureGroup(sizes: FigurePanelSize[], titleHeight: number): FigureGroupLayout | null {
    if (!Number.isFinite(titleHeight) || titleHeight < 0 || sizes.length < 2 || sizes.length > 6 || sizes.some((size) =>
        !Number.isFinite(size.width) || size.width <= 0 || size.width > 800
        || !Number.isFinite(size.height) || size.height <= 0 || size.height > 800
        || (size.minimumFontSize !== undefined && (!Number.isFinite(size.minimumFontSize) || size.minimumFontSize <= 0)))) return null;

    const width = 800;
    const padding = 24;
    const gap = 24;
    const labelHeight = 34;
    for (const columns of [2, 1]) {
        const cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
        const scale = Math.min(1, ...sizes.map((size) => cellWidth / size.width));
        if (sizes.some((size) => size.minimumFontSize !== undefined && size.minimumFontSize * scale < 12)) continue;
        const panels: FigureGroupLayout['panels'] = [];
        let y = padding + titleHeight;
        for (let index = 0; index < sizes.length; index += columns) {
            const row = sizes.slice(index, index + columns);
            const rowHeight = Math.max(...row.map((size) => size.height * scale));
            row.forEach((size, column) => {
                const x = padding + column * (cellWidth + gap);
                panels.push({
                    x: x + (cellWidth - size.width * scale) / 2,
                    y: y + labelHeight,
                    width: size.width * scale,
                    height: size.height * scale,
                    labelX: x + cellWidth / 2,
                    labelY: y + 23,
                });
            });
            y += labelHeight + rowHeight + gap;
        }
        const height = Math.ceil(y);
        if (height <= 1800) return { width, height, scale, panels };
    }
    return null;
}

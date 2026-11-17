import { MAX_FIGURE_SVG_LENGTH } from './figure-svg';

interface FigureReadingSize {
    width: number;
    height: number;
    minimumFontSize: number;
}

const svgNumber = (value: string | null) => value && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
const MAX_READING_SCALE = 4;
const MAX_READING_WIDTH = 2400;
const MAX_READING_HEIGHT = 4800;
const viewBox = (element: Element) => {
    const values = (element.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(svgNumber);
    return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0 ? values : null;
};

/**
 * 测量显式字号与等比例子画布；传入当前显示尺寸后，同时补偿手机窄屏或高度上限造成的整体缩小。
 * 不把不明样式或变换的旧 SVG 当作可可靠测量的图。
 */
export function getFigureReadingSize(
    markup: string,
    width: number,
    height: number,
    displayedWidth = width,
    displayedHeight = height,
): FigureReadingSize | null {
    if (typeof DOMParser === 'undefined' || markup.length > MAX_FIGURE_SVG_LENGTH
        || ![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
    const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = document.documentElement;
    if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg'
        || root.querySelector('[transform], [style], style, use, textPath, tspan[font-size]')
        || root.hasAttribute('transform') || root.hasAttribute('style')) return null;
    let minimumFontSize = Infinity;
    const measure = (element: Element, scale: number): boolean => {
        if (element.localName === 'text' && element.textContent?.trim()) {
            const fontSize = svgNumber(element.getAttribute('font-size'));
            if (!Number.isFinite(fontSize) || fontSize <= 0) return false;
            minimumFontSize = Math.min(minimumFontSize, fontSize * scale);
        }
        if (element.localName === 'svg') {
            const bounds = viewBox(element);
            const ratio = element.getAttribute('preserveAspectRatio');
            if (!bounds || (ratio !== null && ratio !== 'xMidYMid meet')) return false;
            const viewportWidth = element === root ? width : svgNumber(element.getAttribute('width'));
            const viewportHeight = element === root ? height : svgNumber(element.getAttribute('height'));
            if (![viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0)) return false;
            scale *= Math.min(viewportWidth / bounds[2], viewportHeight / bounds[3]);
        }
        return Array.from(element.children).every((child) => measure(child, scale));
    };
    if (!measure(root, 1) || !Number.isFinite(minimumFontSize)) return null;
    // 隐藏容器或尚未完成布局时没有可用的显示尺寸，先按原始尺寸保持文字可读。
    const renderedScale = [displayedWidth, displayedHeight].every((value) => Number.isFinite(value) && value > 0)
        ? Math.min(1, displayedWidth / width, displayedHeight / height)
        : 1;
    const requestedScale = Math.max(1, 12 / (minimumFontSize * renderedScale));
    // Keep a scrollable reading surface when a constrained first layout would
    // require more pixels than the safe rasterization budget. A source canvas
    // that is already larger than the budget still falls back to its original
    // display path because it cannot be reduced without losing content.
    const maximumScale = Math.min(MAX_READING_SCALE, MAX_READING_WIDTH / width, MAX_READING_HEIGHT / height);
    if (requestedScale > MAX_READING_SCALE || !Number.isFinite(maximumScale) || maximumScale < 1) return null;
    const scale = Math.min(requestedScale, maximumScale);
    return { width: width * scale, height: height * scale, minimumFontSize: minimumFontSize * scale };
}

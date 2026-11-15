import { describe, expect, it } from 'vitest';
import { FIGURE_GROUP_FIXTURES } from '@/__tests__/fixtures/figure-group-fixtures';
import { HEADING_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-heading-fixtures';
import { getFigureReadingSize } from '@/lib/figure-reading';
import { renderFigureSpec } from '@/lib/figure-spec';

const wrap = (content: string, attributes = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" ${attributes}>${content}</svg>`;

describe('配图默认阅读尺寸', () => {
    it('按照实际字号放大，保持宽高比例，不放大本来就能读清的图', () => {
        expect(getFigureReadingSize(wrap('<text font-size="8">长度</text>'), 800, 500)).toEqual({ width: 1200, height: 750, minimumFontSize: 12 });
        expect(getFigureReadingSize(wrap('<text font-size="20">长度</text>'), 800, 500)).toEqual({ width: 800, height: 500, minimumFontSize: 20 });
    });

    it('逐层计算子图共同缩放后的字号，不能只读取原始字号', () => {
        const svg = wrap('<svg width="400" height="250" viewBox="0 0 800 500"><g><svg width="400" height="250" viewBox="0 0 800 500"><text font-size="24">甲</text></svg></g></svg>');
        expect(getFigureReadingSize(svg, 800, 500)).toEqual({ width: 1600, height: 1000, minimumFontSize: 12 });
    });

    it.each([...HEADING_FIGURE_FIXTURES, ...FIGURE_GROUP_FIXTURES])('$id 的有效结构化图保持原有尺寸和至少 12px 阅读字号', ({ spec }) => {
        const svg = renderFigureSpec(JSON.stringify(spec))!;
        expect(svg).not.toBeNull();
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        const width = Number(root.getAttribute('width'));
        const height = Number(root.getAttribute('height'));
        const reading = getFigureReadingSize(svg, width, height)!;
        expect(reading).not.toBeNull();
        expect(reading.minimumFontSize).toBeGreaterThanOrEqual(12);
        expect(reading.width / reading.height).toBeCloseTo(width / height, 10);
        expect(reading.width).toBeCloseTo(width, 10);
    });

    it.each([
        '<svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', wrap('<circle r="10"/>'),
        wrap('<text>未声明字号</text>'), wrap('<text font-size="0">长度</text>'), wrap('<text font-size="NaN">长度</text>'),
        wrap('<text font-size="0.1">长度</text>'), wrap('<text font-size="20px">旧字号</text>'),
        wrap('<text font-size="20" transform="scale(0.1)">长度</text>'), wrap('<style>text {font-size: 2px}</style><text font-size="20">长度</text>'),
        wrap('<text font-size="20"><tspan font-size="2">长度</tspan></text>'),
        wrap('<text font-size="20" style="font-size:2px">长度</text>'),
        wrap('<use href="#label"/><text font-size="20">长度</text>'),
        wrap('<svg viewBox="0 0 10 10" width="50%" height="100"><text font-size="20">长度</text></svg>'),
        wrap('<text font-size="20">长度</text>', 'preserveAspectRatio="none"'),
        wrap('<text font-size="20">长度</text>', 'transform="scale(0.1)"'),
        wrap('<text font-size="20">长度</text>').replace('0 0 800 500', '0 0 0 500'),
    ])('无法可靠测量时沿用原显示与大图入口：%s', (svg) => {
        expect(getFigureReadingSize(svg, 800, 500)).toBeNull();
    });

    it.each([0, -1, NaN, Infinity, 10000])('无效或过大原始尺寸 %s 不创建无限阅读区域', (size) => {
        expect(getFigureReadingSize(wrap('<text font-size="20">长度</text>'), size, 500)).toBeNull();
    });
});

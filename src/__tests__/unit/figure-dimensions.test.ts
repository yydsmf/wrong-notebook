import { describe, expect, it } from 'vitest';
import { DIMENSION_FIGURE_FIXTURES, UNREADABLE_DIMENSION_SPECS } from '@/__tests__/fixtures/figure-dimension-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const number = (element: Element, attribute: string) => Number(element.getAttribute(attribute));

describe('面积和立体图的尺寸标注', () => {
    it.each(DIMENSION_FIGURE_FIXTURES)('$id 完整保留尺寸和标题，明确每段尺寸所属的边', ({ spec, mustContain }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).toBe(svg);
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        const [left, top, width, height] = document.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(width).toBeLessThan(800);
        expect(height).toBeLessThan(500);
        const texts = Array.from(document.querySelectorAll('text'));
        for (const value of mustContain) expect(texts.some((text) => text.textContent?.includes(value))).toBe(true);
        for (const text of texts) {
            expect(number(text, 'font-size')).toBeGreaterThanOrEqual(12);
            expect(['segment', 'fixed']).toContain(text.getAttribute('data-figure-label'));
            expect(number(text, 'x')).toBeGreaterThan(left);
            expect(number(text, 'x')).toBeLessThan(left + width);
            expect(number(text, 'y')).toBeGreaterThan(top);
            expect(number(text, 'y')).toBeLessThan(top + height);
        }
        for (const label of document.querySelectorAll('text[data-figure-label="segment"]')) {
            expect(Array.from(document.querySelectorAll('line')).some((line) => [false, true].some((reverse) => ['x', 'y'].every((axis) =>
                Math.abs(number(line, `${axis}${reverse ? 2 : 1}`) - number(label, `data-from-${axis}`)) < 1e-8
                && Math.abs(number(line, `${axis}${reverse ? 1 : 2}`) - number(label, `data-to-${axis}`)) < 1e-8)))).toBe(true);
        }
    });

    it.each(['rectangle', 'triangle', 'parallelogram', 'trapezoid'])('%s 的底、高归属独立，收紧画布不改变尺寸比例', (shape) => {
        const spec = { type: 'area_geometry', shape, width: 6, height: 4, ...(shape === 'trapezoid' ? { topWidth: 3 } : {}), baseLabel: '底', heightLabel: '高' };
        const svg = renderFigureSpec(raw(spec))!;
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const labels = Array.from(document.querySelectorAll('text'));
        const base = labels.find((label) => label.textContent === '底')!;
        const altitude = labels.find((label) => label.textContent === '高')!;
        const baseLength = number(base, 'data-to-x') - number(base, 'data-from-x');
        const heightLength = number(altitude, 'data-from-y') - number(altitude, 'data-to-y');
        expect(baseLength / heightLength).toBeCloseTo(6 / 4, 10);
        expect(number(base, 'data-from-y')).toBeCloseTo(number(base, 'data-to-y'), 10);
        expect(number(base, 'data-from-y')).toBeCloseTo(number(altitude, 'data-from-y'), 10);
        expect(number(altitude, 'data-from-x')).toBeCloseTo(number(altitude, 'data-to-x'), 10);
    });

    it.each(UNREADABLE_DIMENSION_SPECS)('尺寸或标题无法可靠排版时整图回退：$type / $shape', (spec) => {
        expect(parseFigureSpec(raw(spec))).not.toBeNull();
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        expect(parseFigure('true', undefined, raw(spec)).figureSvg).toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>';
        expect(parseFigure('true', legacy, raw(spec)).figureSvg).toContain('<circle');
        expect(renderFigureSpec(raw({ type: 'figure_group', figures: [{ label: '甲', figure: DIMENSION_FIGURE_FIXTURES[0].spec }, { label: '乙', figure: spec }] }))).toBeNull();
    });
});

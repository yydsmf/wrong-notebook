import { describe, expect, it } from 'vitest';
import { DIMENSION_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-dimension-fixtures';
import { HEADING_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-heading-fixtures';
import { STRUCTURED_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-spec-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const readSvg = (spec: unknown) => {
    const svg = renderFigureSpec(raw(spec));
    expect(svg).not.toBeNull();
    return new DOMParser().parseFromString(svg!, 'image/svg+xml');
};
const polygons = (document: Document) => Array.from(document.querySelectorAll('polygon'), (polygon) => polygon.getAttribute('points'));

describe('面积和立体图的标题排版', () => {
    it.each(DIMENSION_FIGURE_FIXTURES.filter(({ spec }) => spec.title))('$id 完整保留标题，最多三行，且不改变图形或尺寸位置', ({ spec, unbrokenText }) => {
        const withTitle = readSvg(spec);
        const withoutTitle = readSvg({ ...spec, title: undefined });
        const title = withTitle.querySelector('text[data-figure-title="true"]')!;
        expect(title).not.toBeNull();
        const parsed = parseFigureSpec(raw(spec));
        if (!parsed || !('title' in parsed)) throw new Error('标题未正确解析');
        expect(title.textContent).toBe(parsed.title);
        expect(title.querySelectorAll('tspan').length).toBeLessThanOrEqual(3);
        expect(Number(title.getAttribute('font-size'))).toBeGreaterThanOrEqual(12);
        const pieces = Array.from(title.querySelectorAll('tspan'), (line) => line.textContent ?? '');
        for (const token of unbrokenText ?? []) expect(pieces.some((line) => line.includes(token))).toBe(true);
        expect(polygons(withTitle)).toEqual(polygons(withoutTitle));
        const dimensions = (document: Document) => Array.from(document.querySelectorAll('text[data-figure-label="segment"]'), (label) => label.outerHTML);
        expect(dimensions(withTitle)).toEqual(dimensions(withoutTitle));
        const notes = (document: Document) => Array.from(document.querySelectorAll('text[data-figure-label="fixed"]:not([data-figure-title])'), (label) => label.outerHTML);
        expect(notes(withTitle)).toEqual(notes(withoutTitle));
        expect(withTitle.querySelector('g[transform]')).toBeNull();
    });

    it('横长矩形的标题按图宽换行，不再用一行标题撑宽整张题图', () => {
        const spec = DIMENSION_FIGURE_FIXTURES.find(({ id }) => id === 'dimension-rectangle-wide')!.spec;
        const document = readSvg(spec);
        const [, , width, height] = document.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(width).toBeLessThan(420);
        expect(height).toBeLessThan(250);
        const title = document.querySelector('text[data-figure-title="true"]')!;
        expect(title.querySelectorAll('tspan').length).toBeGreaterThan(1);
        const minimumY = Math.min(...Array.from(document.querySelectorAll('polygon'), (polygon) => polygon.getAttribute('points')!.split(/\s+/).map((point) => Number(point.split(',')[1]))).flat());
        const fontSize = Number(title.getAttribute('font-size'));
        const offset = Array.from(title.querySelectorAll('tspan'), (line) => Number(line.getAttribute('dy'))).reduce((sum, dy) => sum + dy, 0);
        const bottom = Number(title.getAttribute('y')) + offset + fontSize * 0.4;
        expect(bottom).toBeLessThan(minimumY - 8);
    });

    it.each(['area_geometry', 'solid_geometry'])('%s 的长中文标题可换行，完整长数值无法放下则整图回退', (type) => {
        const geometry = type === 'area_geometry'
            ? { type, shape: 'square', width: 5, height: 5 }
            : { type, shape: 'cube', width: 5, depth: 5, height: 5 };
        expect(renderFigureSpec(raw({ ...geometry, title: '完整保留标题'.repeat(10) }))).not.toBeNull();
        const indivisible = { ...geometry, title: '1234567890'.repeat(6) };
        expect(parseFigureSpec(raw(indivisible))).not.toBeNull();
        expect(renderFigureSpec(raw(indivisible))).toBeNull();
    });
});

describe('圆图与坐标图的独立长标题区', () => {
    it.each(HEADING_FIGURE_FIXTURES)('$id 完整换行，图形内部坐标和所有标注保持原样', ({ spec, unbrokenText }) => {
        const document = readSvg(spec);
        const plain = readSvg({ ...spec, title: undefined });
        const title = document.querySelector('text[data-figure-title="true"]')!;
        const body = document.querySelector('g[data-figure-body="true"] > svg')!;
        expect(title).not.toBeNull();
        expect(body).not.toBeNull();
        const parsed = parseFigureSpec(raw(spec));
        if (!parsed || !('title' in parsed)) throw new Error('标题未正确解析');
        expect(title.textContent).toBe(parsed.title);
        const pieces = Array.from(title.querySelectorAll('tspan'), (line) => line.textContent ?? '');
        expect(pieces.length).toBeGreaterThan(1);
        expect(pieces.length).toBeLessThanOrEqual(3);
        for (const token of unbrokenText ?? []) expect(pieces.some((line) => line.includes(token))).toBe(true);
        expect(Number(title.getAttribute('font-size'))).toBeGreaterThanOrEqual(12);
        expect(body.innerHTML).toBe(plain.documentElement.innerHTML);
        expect(body.getAttribute('viewBox')).toBe(plain.documentElement.getAttribute('viewBox'));
        const [, , width, height] = body.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(Number(body.getAttribute('width'))).toBe(width);
        expect(Number(body.getAttribute('height'))).toBe(height);
        const [, , outerWidth, outerHeight] = document.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(outerWidth).toBeLessThanOrEqual(Math.max(width, 524));
        expect(outerHeight).toBeLessThanOrEqual(800);
        expect(document.querySelector('g[transform]')).toBeNull();
        expect(renderFigureSpec(raw(spec))).toBe(renderFigureSpec(raw(spec)));
        expect(parseFigure('true', undefined, raw(spec)).figureSvg).toBe(renderFigureSpec(raw(spec)));
    });

    it.each(['junior-title-circle', 'junior-title-coordinate'])('%s 的超宽完整数值整图回退，保留旧 SVG 兜底', (id) => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((entry) => entry.id === id)!;
        const spec = raw({ ...fixture.spec, title: '1234567890'.repeat(6) });
        expect(parseFigureSpec(spec)).not.toBeNull();
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        expect(parseFigure('true', undefined, spec).figureSvg).toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>';
        expect(parseFigure('true', legacy, spec).figureSvg).toContain('<circle');
        expect(renderFigureSpec(raw({ type: 'figure_group', figures: [{ label: '甲', figure: fixture.spec }, { label: '乙', figure: JSON.parse(spec) }] }))).toBeNull();
    });
});

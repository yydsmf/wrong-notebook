import { describe, expect, it } from 'vitest';
import { EXTERIOR_ALTITUDE_FIXTURES } from '@/__tests__/fixtures/figure-altitude-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (value: unknown) => JSON.stringify(value);
const number = (element: Element, attribute: string) => Number(element.getAttribute(attribute));

describe('面积模板的外部高与底边延长线', () => {
    it.each(EXTERIOR_ALTITUDE_FIXTURES)('$id 保留原参数并绘出外部高，不把延长线算进底长', ({ spec, footRatio, baseHeightRatio, mustContain }) => {
        const result = parseFigureSpecDetailed(raw(spec));
        expect(result.diagnostic.ok).toBe(true);
        expect(result.spec).toMatchObject(spec);
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        const points = document.querySelector('polygon')!.getAttribute('points')!.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
        const [[left, bottom], [right]] = points;
        const top = Math.min(...points.map((point) => point[1]));
        const height = document.querySelector('[data-area-part="height"] line')!;
        const extension = document.querySelector('[data-area-part="base-extension"] line')!;
        expect(height).not.toBeNull();
        expect(extension).not.toBeNull();
        const foot = number(height, 'x1');
        expect((foot - left) / (right - left)).toBeCloseTo(footRatio, 4);
        expect(foot).toBeCloseTo(footRatio < 0 ? Math.min(...points.map((point) => point[0])) : Math.max(...points.map((point) => point[0])), 3);
        expect((right - left) / (bottom - top)).toBeCloseTo(baseHeightRatio, 4);
        expect(number(height, 'x2')).toBeCloseTo(foot, 3);
        expect(number(height, 'y1')).toBeCloseTo(bottom, 3);
        expect(number(height, 'y2')).toBeCloseTo(top, 3);
        expect(number(extension, 'x1')).toBeCloseTo(foot, 3);
        expect(number(extension, 'x2')).toBeCloseTo(footRatio < 0 ? left : right, 3);
        expect(number(extension, 'y1')).toBeCloseTo(bottom, 3);
        expect(number(extension, 'y2')).toBeCloseTo(bottom, 3);
        expect(height.getAttribute('stroke-dasharray')).toBe('7 5');
        expect(extension.getAttribute('stroke-dasharray')).toBe('7 5');
        const marker = document.querySelector('[data-area-part="right-angle"] path')!;
        const pathPoints = marker.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        expect(pathPoints[0]).toBeCloseTo(foot, 3);
        expect(pathPoints[2]).toBe(pathPoints[4]);
        expect(pathPoints[1]).toBe(pathPoints[3]);
        expect(pathPoints[5]).toBeCloseTo(bottom, 3);
        expect(Math.sign(pathPoints[2] - foot)).toBe(footRatio < 0 ? 1 : -1);
        expect(Math.abs(pathPoints[2] - foot)).toBeCloseTo(bottom - pathPoints[1], 3);
        const baseLabel = Array.from(document.querySelectorAll('text')).find((text) => text.textContent === spec.baseLabel)!;
        expect(number(baseLabel, 'data-from-x')).toBeCloseTo(left, 3);
        expect(number(baseLabel, 'data-to-x')).toBeCloseTo(right, 3);
        for (const value of mustContain) expect(document.documentElement.textContent).toContain(value);
    });

    it.each(EXTERIOR_ALTITUDE_FIXTURES)('$id 等比放大相对尺寸不改图形或标签', ({ spec }) => {
        const scaled = {
            ...spec, width: Number(spec.width) * 2, height: Number(spec.height) * 2,
            ...(spec.topWidth !== undefined ? { topWidth: Number(spec.topWidth) * 2 } : {}),
            ...(spec.offset !== undefined ? { offset: Number(spec.offset) * 2 } : {}),
        };
        expect(renderFigureSpec(raw(scaled))).toBe(renderFigureSpec(raw(spec)));
    });

    it.each([0, 0.35, 0.5, 1])('三角形内部或端点高 %s 不绘制额外延长线', (apexRatio) => {
        const spec = { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio, baseLabel: '底6', heightLabel: '高4' };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(svg).not.toContain('data-area-part="base-extension"');
        if (apexRatio === 0 || apexRatio === 1) expect(svg).not.toContain('data-area-part="height"');
        else expect(svg).toContain('data-area-part="height"');
    });

    it.each([-1.001, 2.001])('越出有限三角形范围 %s 时仍拒绝，不夹到边界', (apexRatio) => {
        const spec = { ...EXTERIOR_ALTITUDE_FIXTURES[0].spec, apexRatio };
        expect(parseFigureSpecDetailed(raw(spec)).diagnostic.reason).toBe('schema_validation');
    });

    it.each(['等腰', '等边', '直角'])('外部高不能冒充明确的%s三角形', (subtype) => {
        const spec = EXTERIOR_ALTITUDE_FIXTURES[0].spec;
        const text = `下图是一个${subtype}三角形。`;
        expect(renderFigureSpecDetailed(raw(spec), text)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it('未知底高标注保持原文，不推算斜边、面积或空格答案', () => {
        const spec = { ...EXTERIOR_ALTITUDE_FIXTURES[0].spec, baseLabel: '底□cm', heightLabel: '高?cm' };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(svg).toContain('底□cm');
        expect(svg).toContain('高?cm');
        expect(svg).not.toContain('面积');
        expect(parseFigureSpecDetailed(raw(spec)).spec).toMatchObject(spec);
    });

    it('新范围不让面积模板冒充具有指定顶点的通用几何图', () => {
        expect(renderFigureSpecDetailed(raw(EXTERIOR_ALTITUDE_FIXTURES[0].spec), '三角形ABC是一个三角形。')).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it('图组保留全部子图，无法排版时整组回退完整旧 SVG', () => {
        const first = EXTERIOR_ALTITUDE_FIXTURES[0].spec;
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: first }, { label: '乙', figure: EXTERIOR_ALTITUDE_FIXTURES[1].spec },
        ] };
        expect(renderFigureSpec(raw(group))).not.toBeNull();
        const unreadable = { ...group, figures: [group.figures[0], { label: '乙', figure: { ...first, title: '1234567890'.repeat(6) } }] };
        expect(renderFigureSpecDetailed(raw(unreadable))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧双图</text></svg>';
        expect(parseFigure('true', legacy, raw(unreadable))).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(unreadable))).toEqual({ hasFigure: true, figureSvg: null });
    });
});

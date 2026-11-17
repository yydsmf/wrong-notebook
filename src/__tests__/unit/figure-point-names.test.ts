import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const types = ['basic_geometry', 'coordinate_plane', 'circle_geometry'] as const;
type GeometryType = typeof types[number];

function geometry(type: GeometryType, first?: string, second?: string) {
    const points = [{ id: 'p1', x: 80, y: 50, label: first }, { id: 'p2', x: 50, y: 20, label: second }];
    if (type === 'circle_geometry') return { type, center: { id: 'center', x: 50, y: 50, label: 'O' }, radius: 30, points };
    return {
        type, points, segments: [{ from: 'p1', to: 'p2' }],
        ...(type === 'coordinate_plane' ? { xMin: 0, xMax: 100, yMin: 0, yMax: 100, xStep: 20, yStep: 20 } : {}),
    };
}

const raw = (value: unknown) => JSON.stringify(value);

describe.each(types)('%s 的可见点名对应', (type) => {
    it.each(['A', 'a', 'A1', 'A₁', "A'", 'A′', 'A″'])('拒绝不同点重复显示点名 %s', (name) => {
        const spec = geometry(type, name, name);
        const before = raw(spec);
        expect(renderFigureSpecDetailed(before)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation', type },
        });
        expect(raw(spec)).toBe(before);
    });

    it.each([[' Ａ ', 'A'], ['Ａ₁', 'A₁'], [' A1 ', 'A1']])('规范化后相同的点名也拒绝：%s / %s', (first, second) => {
        expect(parseFigureSpec(raw(geometry(type, first, second)))).toBeNull();
    });

    it.each([['A', 'B'], ['A', 'a'], ['A1', 'A₁'], ['A', 'A′'], ['A′', 'A″']])('保留大小写、下标和撇号不同的点名：%s / %s', (first, second) => {
        const spec = geometry(type, first, second);
        const parsed = parseFigureSpec(raw(spec));
        expect(parsed).toMatchObject({ points: spec.points });
        const rendered = renderFigureSpecDetailed(raw(spec));
        expect(rendered.diagnostic.reason).toBe('ok');
        const document = new DOMParser().parseFromString(rendered.svg!, 'image/svg+xml');
        const labels = Array.from(document.querySelectorAll('text[data-figure-label="point"]'), (element) => element.textContent);
        expect(labels).toContain(first);
        expect(labels).toContain(second);
    });

    it.each([undefined, '', '中点', '顶点A', 'x=1', '?', '10cm', 'α'])('未命名点或非拉丁字母点名说明不作唯一性推断：%s', (label) => {
        expect(parseFigureSpec(raw(geometry(type, label, label)))).not.toBeNull();
    });

    it('显示点名不必等于内部ID，也不与隐藏ID互相混淆', () => {
        const spec = geometry(type, 'p2', 'A');
        expect(parseFigureSpec(raw(spec))).toMatchObject({ points: spec.points });
    });

    it('点名冲突尝试完整旧SVG，没有旧图就不返回新图', () => {
        const spec = geometry(type, 'A', 'A');
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原配图</text></svg>';
        expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
    });
});

describe('点名校验范围', () => {
    it('圆心和圆周点的显示点名同样不能重复', () => {
        expect(parseFigureSpec(raw(geometry('circle_geometry', 'O', 'B')))).toBeNull();
    });

    it('不同子图可重复使用同一个点名，各自对应独立的ID', () => {
        const spec = { type: 'figure_group', figures: [
            { label: '甲', figure: geometry('basic_geometry', 'A', 'B') },
            { label: '乙', figure: geometry('circle_geometry', 'A', 'B') },
        ] };
        expect(renderFigureSpecDetailed(raw(spec)).diagnostic.reason).toBe('ok');
        const invalid = { ...spec, figures: [spec.figures[0], { label: '乙', figure: geometry('circle_geometry', 'A', 'A') }] };
        expect(renderFigureSpecDetailed(raw(invalid))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整图组</text></svg>';
        expect(parseFigure('true', legacy, raw(invalid))).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('点名检查不把线段标签、自由说明或圆名当作另一个点', () => {
        const spec = { ...geometry('basic_geometry', 'A', 'B'),
            segments: [{ from: 'p1', to: 'p2', label: 'A' }], labels: [{ text: 'A', x: 20, y: 70 }],
        };
        expect(parseFigureSpec(raw(spec))).not.toBeNull();
    });
});

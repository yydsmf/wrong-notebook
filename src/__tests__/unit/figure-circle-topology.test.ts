import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const base = {
    type: 'circle_geometry', center: { id: 'O', x: 50, y: 50 }, radius: 30,
};
const raw = (spec: unknown) => JSON.stringify(spec);
const pointAt = (id: string, angle: number, radius = 30) => ({
    id, x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius,
});
const collapsedPoints = [
    [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 80, y: 50 }],
    [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 80.8, y: 50 }],
    [{ id: 'A', x: 20, y: 50 }, { id: 'B', x: 19.2, y: 50 }],
    [{ id: 'A', x: 68, y: 74 }, { id: 'B', x: 68.48, y: 74.64 }],
];

describe('圆周对齐后的点位与线段拓扑', () => {
    it.each(collapsedPoints)('不同点名不能在圆周对齐后重合：%s', (...points) => {
        for (const spec of [
            { ...base, points },
            { ...base, points, chords: [{ from: 'A', to: 'B' }] },
            { ...base, points, radii: [{ to: 'A' }, { to: 'B' }] },
        ]) {
            expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({
                svg: null, diagnostic: { reason: 'semantic_validation', type: 'circle_geometry' },
            });
        }
    });

    it('有正长度标注的弦也不能在绘制时变成零长度', () => {
        const spec = { ...base, points: collapsedPoints[1], chords: [{ from: 'A', to: 'B', label: '4cm' }] };
        expect(parseFigureSpec(raw(spec))).toBeNull();
    });

    it.each([0, 0.7, 2.8, 4.4])('直径在对齐后仍须经过圆心，方向%s', (angle) => {
        const points = [pointAt('A', angle, 29.11), pointAt('B', angle + Math.PI - 0.061, 29.11)];
        const spec = { ...base, points, diameters: [{ from: 'A', to: 'B' }] };
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it.each([0, 0.7, 2.8, 4.4])('保留误差容限内的直径和不同半径误差，方向%s', (angle) => {
        const points = [pointAt('A', angle, 30.8), pointAt('B', angle + Math.PI - 0.04, 29.2)];
        const spec = { ...base, points, diameters: [{ from: 'A', to: 'B' }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
        expect(renderFigureSpecDetailed(raw(spec)).diagnostic.reason).toBe('ok');
    });

    it.each([0.000001, 0.005, Math.PI / 2, Math.PI])('不同方向的点不会因弧方向阈值被当成重合，角差%s', (delta) => {
        const points = [pointAt('A', 0), pointAt('B', delta)];
        const spec = { ...base, points, chords: [{ from: 'A', to: 'B' }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('普通圆周误差仍按原方向对齐，弦端点与点标记保持一致', () => {
        const spec = {
            ...base,
            points: [{ id: 'A', x: 80.3, y: 50 }, { id: 'B', x: 50, y: 19.7 }],
            radii: [{ to: 'A' }], chords: [{ from: 'A', to: 'B' }],
        };
        const result = renderFigureSpecDetailed(raw(spec));
        expect(result.diagnostic.reason).toBe('ok');
        const document = new DOMParser().parseFromString(result.svg!, 'image/svg+xml');
        const vertices = Array.from(document.querySelectorAll('circle[r="3.5"]')).slice(1);
        expect(vertices).toHaveLength(2);
        const coordinates = vertices.map((point) => ({ x: Number(point.getAttribute('cx')), y: Number(point.getAttribute('cy')) }));
        expect(coordinates).toEqual([{ x: 517, y: 250 }, { x: 400, y: 133 }]);
        expect(Array.from(document.querySelectorAll('line')).some((line) =>
            Number(line.getAttribute('x1')) === coordinates[0].x
            && Number(line.getAttribute('y1')) === coordinates[0].y
            && Number(line.getAttribute('x2')) === coordinates[1].x
            && Number(line.getAttribute('y2')) === coordinates[1].y)).toBe(true);
        expect(renderFigureSpecDetailed(raw(spec)).svg).toBe(result.svg);
    });

    it('同样的点名可以出现在不同子图，退化子图仍使整组回退', () => {
        const good = { ...base, points: [pointAt('A', 0), pointAt('B', Math.PI / 2)] };
        const bad = { ...base, points: collapsedPoints[1], chords: [{ from: 'A', to: 'B' }] };
        const group = { type: 'figure_group', figures: [{ label: '甲', figure: good }, { label: '乙', figure: good }] };
        expect(renderFigureSpecDetailed(raw(group)).diagnostic.reason).toBe('ok');
        const invalidGroup = { ...group, figures: [{ label: '甲', figure: good }, { label: '乙', figure: bad }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧配图</text></svg>';
        for (const spec of [bad, invalidGroup]) {
            expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });
});

import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';
import type { FigureSpec } from '@/lib/figure-spec';

type Geometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
const question = '下图是一个三角形，求它的周长。';
const raw = (value: unknown) => JSON.stringify(value);

function triangle(lengths: Array<string | undefined>): Geometry {
    return {
        type: 'basic_geometry',
        points: [
            { id: 'A', label: 'A', x: 20, y: 80 },
            { id: 'B', label: 'B', x: 80, y: 80 },
            { id: 'C', label: 'C', x: 40, y: 25 },
        ],
        polygons: [{ points: ['A', 'B', 'C'] }],
        segments: [
            { from: 'A', to: 'B', label: lengths[0] },
            { from: 'B', to: 'C', label: lengths[1] },
            { from: 'C', to: 'A', label: lengths[2] },
        ],
        angles: [], circles: [], labels: [],
    };
}

describe('明确三角形主图的完整边长', () => {
    it.each([
        ['3cm', '4cm', '8cm'],
        ['3cm', '4cm', '7cm'],
        ['8cm', '3cm', '4cm'],
        ['4cm', '8cm', '3cm'],
        ['0.1cm', '0.2cm', '0.3cm'],
        ['1/2m', '1/3m', '5/6m'],
        ['1又1/2cm', '1/2cm', '2cm'],
        ['3cm', '40mm', '0.08m'],
        ['3', '4', '8'],
        ['边长3cm', '长度4cm', '8cm'],
        ['1cm', '1cm', '2.0000000000000001cm'],
        ['9007199254740992cm', '1cm', '9007199254740993cm'],
    ])('拒绝两边之和不大于第三边：%s、%s、%s', (...lengths) => {
        expect(renderFigureSpecDetailed(raw(triangle(lengths)), question)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it('合法三角形仍保留原始边长和坐标，不按示意图比例重算', () => {
        const spec = triangle(['3cm', '4cm', '5cm']);
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        expect(renderFigureSpec(raw(spec), question)).toBe(renderFigureSpec(raw(spec)));
    });

    it.each([
        ['0.3dm', '40mm', '0.05m'],
        ['3CM', '4厘米', '50mm'],
        ['1/2m', '1/3m', '2/3m'],
        ['1又1/2cm', '1/2cm', '1.9cm'],
        ['0.1cm', '0.2cm', '0.29999999999999999cm'],
        ['9007199254740993cm', '1cm', '9007199254740993cm'],
        ['3', '4.0', '5/1'],
    ])('精确接受合法数值，不以浮点容差吞掉差异：%s、%s、%s', (...lengths) => {
        const spec = triangle(lengths);
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
    });

    it.each(['8', '√64cm', 'x+8cm', '1/□cm', '?', '____', '约8cm', '8in', undefined])('未知或不可比较的第三边 %s 不补值或继承单位', (third) => {
        const spec = triangle(['3cm', '4cm', third]);
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
    });

    it('已知长度不被同边的未知标签掩盖，等值单位标签仍可保留', () => {
        const spec = triangle(['3cm', '4cm', '8cm']);
        spec.segments.push({ from: 'A', to: 'B', label: '30mm' }, { from: 'A', to: 'C', label: 'x' });
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
        spec.segments[2].label = '5cm';
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
    });

    it('同一边的无单位标注与公制标注分别检查，不相互掩盖完整三边冲突', () => {
        const spec = triangle(['3cm', '4cm', '5cm']);
        spec.segments.push(
            { from: 'A', to: 'B', label: '3' },
            { from: 'B', to: 'C', label: '4' },
            { from: 'C', to: 'A', label: '8' },
        );
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it.each([false, true])('正反向顶点和乱序线段均按完整边对应：reverse=%s', (reverse) => {
        const spec = triangle(['3cm', '4cm', '8cm']);
        if (reverse) spec.polygons[0].points.reverse();
        spec.segments = [...spec.segments].reverse().map(({ from, to, label }) => ({ from: to, to: from, label }));
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('没有 polygon 的唯一闭合线段环也核对三边', () => {
        const spec = triangle(['3cm', '4cm', '8cm']);
        spec.polygons = [];
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
        spec.segments[2].label = '5cm';
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
    });

    it('共线中间点只用于识别整边，不将分段或虚线高当作完整边长', () => {
        const spec = triangle(['3cm', '4cm', '8cm']);
        spec.points.push({ id: 'D', label: 'D', x: 50, y: 80 });
        spec.polygons[0].points = ['A', 'D', 'B', 'C'];
        spec.segments.push(
            { from: 'A', to: 'D', label: '1cm' },
            { from: 'D', to: 'B', label: '2cm' },
            { from: 'C', to: 'D', label: '100cm', dashed: true },
        );
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
        spec.segments[2].label = '5cm';
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        spec.segments[2].label = '8cm';
        spec.segments = spec.segments.filter(({ from, to }) => !(from === 'A' && to === 'B'));
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
    });

    it.each(['下图是一个等腰三角形。', '三角形ABC为等腰三角形。', 'Triangle ABC is an isosceles triangle.'])('等腰的两腰相等仍须满足三边不等式：%s', (text) => {
        const spec = triangle(['5cm', '2cm', '2cm']);
        spec.points[2].x = 50;
        expect(parseFigureSpecDetailed(raw(spec), text).diagnostic.reason).toBe('semantic_validation');
        spec.segments[0].label = '3cm';
        expect(parseFigureSpecDetailed(raw(spec), text).spec).toEqual(spec);
    });

    it.each([
        '',
        '下图是一个三角形吗？',
        '请判断下图是一个三角形。',
        '若下图是一个三角形，求周长。',
        '下图是一个三角形。这个说法正确吗？',
        'The figure is a triangle. True or false?',
        'Assume the figure is a triangle.',
        '“下图是一个三角形。”',
        '下列哪组三边能组成三角形？',
    ])('没有明确主图事实时不替题目作判断：%s', (text) => {
        const spec = triangle(['3cm', '4cm', '8cm']);
        expect(parseFigureSpecDetailed(raw(spec), text).spec).toEqual(spec);
    });

    it('图组逐图校验，冲突时保留整组旧图，不只丢掉错误子图', () => {
        const group = {
            type: 'figure_group', figures: [
                { label: 'A', figure: triangle(['3cm', '4cm', '5cm']) },
                { label: 'B', figure: triangle(['3cm', '4cm', '8cm']) },
            ],
        };
        const scoped = '图A：下图是一个三角形。图B：下图是一个三角形。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整双图</text></svg>';
        expect(renderFigureSpecDetailed(raw(group), scoped)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation', type: 'figure_group' },
        });
        expect(parseFigure('true', legacy, raw(group), scoped)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(group), scoped)).toEqual({ hasFigure: true, figureSvg: null });
        group.figures[1].figure.segments[2].label = '6cm';
        expect(parseFigureSpecDetailed(raw(group), scoped).diagnostic.ok).toBe(true);
    });

    it('图组的候选判断不把三角形条件强加给所有选项', () => {
        const group = {
            type: 'figure_group', figures: [
                { label: 'A', figure: triangle(['3cm', '4cm', '5cm']) },
                { label: 'B', figure: triangle(['3cm', '4cm', '8cm']) },
            ],
        };
        expect(parseFigureSpecDetailed(raw(group), '判断各图三边能否组成三角形。').diagnostic.ok).toBe(true);
    });

    it('冲突时保留完整旧 SVG，无旧图时不返回错误新图', () => {
        const spec = raw(triangle(['3cm', '4cm', '8cm']));
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有完整题图</text></svg>';
        expect(parseFigure('true', legacy, spec, question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

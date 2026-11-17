import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';
import type { FigureSpec } from '@/lib/figure-spec';

type Geometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
type Area = Extract<FigureSpec, { type: 'area_geometry' }>;
const question = '下图是一个菱形，求它的周长。';
const raw = (spec: unknown) => JSON.stringify(spec);

function geometry(coordinates: Array<[number, number]>): Geometry {
    const points = coordinates.map(([x, y], index) => ({ id: String.fromCharCode(65 + index), label: String.fromCharCode(65 + index), x, y }));
    return {
        type: 'basic_geometry', points, polygons: [{ points: points.map(({ id }) => id) }],
        segments: [], circles: [], angles: [], labels: [],
    };
}

const rhombus = () => geometry([[50, 15], [80, 50], [50, 85], [20, 50]]);
const rectangle = () => geometry([[20, 30], [80, 30], [80, 70], [20, 70]]);
const square = () => geometry([[20, 20], [80, 20], [80, 80], [20, 80]]);
const area = (values: Partial<Area> = {}): Area => ({
    type: 'area_geometry', shape: 'parallelogram', width: 5, height: 4, offset: 3,
    baseLabel: '5cm', heightLabel: '4cm', topLabel: '5cm', fill: 'lightblue', ...values,
});

describe('明确菱形主图的结构一致性', () => {
    it.each([
        '下图是一个菱形，求它的周长。',
        '四边形ABCD是菱形。',
        'ABCD为一个菱形。',
        'The figure is a rhombus. Find its perimeter.',
        'Quadrilateral ABCD is a rhombus.',
    ])('拒绝用不等边的矩形冒充菱形：%s', (text) => {
        expect(parseFigureSpecDetailed(raw(rectangle()), text)).toMatchObject({
            spec: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it.each([rhombus, square])('合法菱形与正方形保持坐标、标签和渲染不变', (factory) => {
        const spec = factory();
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        expect(renderFigureSpec(raw(spec), question)).toBe(renderFigureSpec(raw(spec)));
    });

    it('旋转、循环和反向读取边界不改变菱形及其可见点名', () => {
        for (const radians of [0, Math.PI / 7, Math.PI / 2]) {
            const spec = rhombus();
            spec.points = spec.points.map((point) => ({
                ...point,
                x: 50 + (point.x - 50) * Math.cos(radians) - (point.y - 50) * Math.sin(radians),
                y: 50 + (point.x - 50) * Math.sin(radians) + (point.y - 50) * Math.cos(radians),
            }));
            for (const names of ['ABCD', 'BCDA', 'DCBA', 'ＣＢＡＤ']) {
                expect(parseFigureSpecDetailed(raw(spec), `${names}是菱形。`).spec).toEqual(spec);
            }
        }
    });

    it.each(['ACBD', 'ABCE', 'abcd'])('不允许其它可见点名或交叉边界冒充具名菱形 %s', (names) => {
        expect(parseFigureSpecDetailed(raw(rhombus()), `${names}是菱形。`).diagnostic.reason).toBe('semantic_validation');
    });

    it.each([
        { name: '风筝形', coordinates: [[50, 10], [80, 40], [50, 85], [20, 40]] },
        { name: '非等边平行四边形', coordinates: [[35, 20], [85, 20], [65, 75], [15, 75]] },
        { name: '凹图', coordinates: [[50, 15], [80, 50], [50, 50], [20, 50]] },
    ] satisfies Array<{ name: string; coordinates: Array<[number, number]> }>)('$name 不满足菱形条件', ({ coordinates }) => {
        expect(parseFigureSpecDetailed(raw(geometry(coordinates)), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('已有相对坐标的小幅误差仍可容许，明显不等边时回退', () => {
        const spec = rhombus();
        spec.points[1].x += 0.1;
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        spec.points[1].x += 5;
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('完整实线闭合环也可表达菱形，线段顺序不影响归属', () => {
        const spec = rhombus();
        spec.polygons = [];
        spec.segments = [
            { from: 'C', to: 'B', label: '5cm' }, { from: 'D', to: 'A', label: '5cm' },
            { from: 'B', to: 'A', label: '5cm' }, { from: 'C', to: 'D', label: '5cm' },
        ];
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        spec.segments[0].label = '6cm';
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('菱形四条完整边的明确标注须相等，不把对角线或高当作边', () => {
        const spec = rhombus();
        spec.segments = [
            { from: 'A', to: 'B', label: '5cm' }, { from: 'C', to: 'B', label: '50mm' },
            { from: 'C', to: 'D', label: '0.5dm' }, { from: 'D', to: 'A', label: '?' },
            { from: 'A', to: 'C', label: '8cm' },
        ];
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        spec.segments[3].label = '6cm';
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('共线中间点、分段和内部虚线高保留原位，不与整边强行等长', () => {
        const spec = rhombus();
        spec.points.push({ id: 'E', label: 'E', x: 65, y: 32.5 }, { id: 'O', label: 'O', x: 50, y: 50 });
        spec.polygons[0].points = ['A', 'E', 'B', 'C', 'D'];
        spec.segments = [
            { from: 'A', to: 'E', label: '2cm' }, { from: 'E', to: 'B', label: '3cm' },
            { from: 'B', to: 'C', label: '5cm' }, { from: 'C', to: 'D', label: '5cm' },
            { from: 'D', to: 'A', label: '?' }, { from: 'E', to: 'O', label: '3cm', dashed: true },
        ];
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        spec.segments[4].label = '6cm';
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('面积模板的斜边也必须与底等长，高可以短于边长', () => {
        expect(parseFigureSpecDetailed(raw(area()), question).diagnostic.ok).toBe(true);
        expect(parseFigureSpecDetailed(raw(area({ offset: 1 })), question).diagnostic.reason).toBe('semantic_validation');
        expect(parseFigureSpecDetailed(raw(area({ heightLabel: '4cm', topLabel: '6cm' })), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('菱形面积题中的边长只与边标注核对，不套到垂直高', () => {
        const text = '下图是一个菱形，边长为6cm，高为4cm。';
        expect(parseFigureSpecDetailed(raw(area()), text).diagnostic.reason).toBe('semantic_validation');
        expect(parseFigureSpecDetailed(raw(area({ baseLabel: '6cm', topLabel: '6cm' })), text).diagnostic.ok).toBe(true);
    });

    it.each(['square', 'rectangle', 'parallelogram'] as const)('面积模板 %s 的正方形也满足菱形，高在此确为边', (shape) => {
        const spec = area({ shape, width: 5, height: 5, offset: shape === 'parallelogram' ? 0 : undefined, heightLabel: '5cm' });
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toEqual(spec);
        expect(parseFigureSpecDetailed(raw({ ...spec, heightLabel: '4cm' }), question).diagnostic.reason).toBe('semantic_validation');
    });

    it.each(['triangle', 'trapezoid'] as const)('其它面积形状 %s 不能冒充菱形', (shape) => {
        const spec = area({ shape, offset: undefined, topWidth: shape === 'trapezoid' ? 3 : undefined });
        expect(parseFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('英语边长与高分别对应标注，不把相对绘图尺寸当成物理长度', () => {
        const text = 'The figure is a rhombus, side length is 6 cm, height is 4 cm.';
        const spec = area({ baseLabel: '6cm', topLabel: '60mm' });
        expect(parseFigureSpecDetailed(raw(spec), text).spec).toEqual(spec);
        expect(parseFigureSpecDetailed(raw({ ...spec, heightLabel: '3cm' }), text).diagnostic.reason).toBe('semantic_validation');
    });

    it.each([
        '下图是一个菱形吗？', '请证明四边形ABCD是菱形。',
        '若下图是一个菱形，求周长。', '下图是一个菱形。这个说法正确吗？',
        'The figure is a rhombus. True or false?', 'Assume the figure is a rhombus.',
        '“下图是一个菱形。”', '比较菱形和矩形的周长。',
    ])('疑问、假设和候选内容不强加为图形事实：%s', (text) => {
        expect(parseFigureSpecDetailed(raw(rectangle()), text).spec).toEqual(rectangle());
    });

    it.each(['The figure is a rhombus.', 'This is a rhombus.', 'ABCD is a rhombus.', 'ABCD are rhombi.'])('接受规范的英文菱形声明，不把普通单词当作顶点：%s', (text) => {
        expect(parseFigureSpecDetailed(raw(rhombus()), text).spec).toEqual(rhombus());
        expect(parseFigureSpecDetailed(raw(rectangle()), text).diagnostic.reason).toBe('semantic_validation');
    });

    it('多个独立主图或未分段的候选选项不强行套用单个菱形条件', () => {
        const multiple = rectangle();
        multiple.polygons.push({ points: ['A', 'B', 'C'] });
        expect(parseFigureSpecDetailed(raw(multiple), question).spec).toEqual(multiple);
        const group = {
            type: 'figure_group', figures: [
                { label: 'A', figure: rhombus() }, { label: 'B', figure: rectangle() },
            ],
        };
        expect(parseFigureSpecDetailed(raw(group), '下列哪幅图是菱形？').diagnostic.ok).toBe(true);
    });

    it('图组沿对应标签校验，明确冲突时保留整组旧 SVG', () => {
        const group = {
            type: 'figure_group', figures: [
                { label: '甲', figure: rhombus() }, { label: '乙', figure: rectangle() },
            ],
        };
        const text = '图甲：下图是一个菱形。图乙：下图是一个菱形。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原有配图</text></svg>';
        expect(renderFigureSpecDetailed(raw(group), text)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation', type: 'figure_group' },
        });
        expect(parseFigure('true', legacy, raw(group), text)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(group), text)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

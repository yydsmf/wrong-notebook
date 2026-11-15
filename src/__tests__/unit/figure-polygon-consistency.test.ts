import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec } from '@/lib/figure-spec';
import type { FigureSpec } from '@/lib/figure-spec';

type Geometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
type Coordinates = Array<[number, number]>;

const coordinates = {
    triangle: [[50, 20], [80, 80], [20, 80]],
    square: [[20, 20], [80, 20], [80, 80], [20, 80]],
    rectangle: [[20, 30], [80, 30], [80, 70], [20, 70]],
    parallelogram: [[35, 20], [85, 20], [65, 75], [15, 75]],
    trapezoid: [[35, 20], [65, 20], [85, 75], [15, 75]],
    irregular: [[20, 20], [70, 25], [85, 75], [15, 75]],
    concave: [[20, 20], [80, 20], [45, 40], [20, 80]],
    pentagon: [[50, 15], [85, 40], [75, 80], [25, 80], [15, 40]],
} satisfies Record<string, Coordinates>;

function geometry(points: Coordinates): Geometry {
    return {
        type: 'basic_geometry',
        points: points.map(([x, y], index) => ({ id: String.fromCharCode(65 + index), x, y })),
        polygons: [{ points: points.map((_, index) => String.fromCharCode(65 + index)) }],
        segments: [], circles: [], angles: [], labels: [],
    };
}

function segmentGeometry(points: Coordinates, edges: Array<[number, number]>, dashed: Array<[number, number]> = []): Geometry {
    const result = geometry(points);
    result.polygons = [];
    result.segments = [
        ...edges.map(([from, to]) => ({ from: String.fromCharCode(65 + from), to: String.fromCharCode(65 + to) })),
        ...dashed.map(([from, to]) => ({ from: String.fromCharCode(65 + from), to: String.fromCharCode(65 + to), dashed: true })),
    ];
    return result;
}

const raw = (spec: unknown) => JSON.stringify(spec);

function expectAccepted(spec: Geometry, question: string) {
    const result = parseFigureSpecDetailed(raw(spec), question);
    expect(result.diagnostic).toEqual({ ok: true, reason: 'ok', type: 'basic_geometry' });
    expect(result.spec).toEqual(spec);
    const svg = renderFigureSpec(raw(spec));
    expect(svg).not.toBeNull();
    expect(renderFigureSpec(raw(spec), question)).toBe(svg);
}

function expectConflict(spec: Geometry, question: string) {
    expect(parseFigureSpecDetailed(raw(spec), question)).toEqual({
        spec: null,
        diagnostic: { ok: false, reason: 'semantic_validation', type: 'basic_geometry' },
    });
}

describe('明确题干与单个通用多边形的一致性', () => {
    it.each([
        ['square', 'rectangle'], ['square', 'parallelogram'], ['square', 'trapezoid'],
        ['rectangle', 'parallelogram'], ['rectangle', 'irregular'],
        ['triangle', 'square'], ['triangle', 'pentagon'],
        ['parallelogram', 'trapezoid'], ['parallelogram', 'irregular'],
        ['trapezoid', 'square'], ['trapezoid', 'rectangle'], ['trapezoid', 'irregular'],
    ] as const)('题干声明%s时拒绝%s坐标', (shape, actual) => {
        expectConflict(geometry(coordinates[actual]), `The figure is a ${shape}. Find its area.`);
    });

    it.each(['square', 'rectangle', 'parallelogram', 'trapezoid'] as const)('凹四边形不能充当%s', (shape) => {
        expectConflict(geometry(coordinates.concave), `The shape is a ${shape}.`);
    });

    it.each([
        ['triangle', '三角形'], ['square', '正方形'], ['rectangle', '长方形'],
        ['parallelogram', '平行四边形'], ['trapezoid', '梯形'],
    ] as const)('接受%s的旋转及反向顶点顺序，不改写输入坐标', (shape, name) => {
        for (const radians of [0, Math.PI / 7, Math.PI / 2]) {
            const rotated = coordinates[shape].map(([x, y]): [number, number] => [
                50 + (x - 50) * Math.cos(radians) - (y - 50) * Math.sin(radians),
                50 + (x - 50) * Math.sin(radians) + (y - 50) * Math.cos(radians),
            ]);
            for (const points of [rotated, [...rotated].reverse()]) {
                expectAccepted(geometry(points), `下图是一个${name}，面积是多少？`);
            }
        }
    });

    it.each(['长方形', '平行四边形'])('正方形也是%s，不按模板名称误拒', (name) => {
        expectAccepted(geometry(coordinates.square), `下图是一个${name}。`);
    });

    it('保留边上中间点、内部辅助点和对角线，只用完整边标注核对等长', () => {
        const spec = geometry([[20, 20], [50, 20], [80, 20], [80, 80], [20, 80]]);
        spec.points.push({ id: 'O', x: 50, y: 50 });
        spec.segments = [
            { from: 'A', to: 'B', label: '3cm' }, { from: 'B', to: 'C', label: '3cm' },
            { from: 'A', to: 'C', label: '6cm' }, { from: 'C', to: 'D', label: '6cm' },
            { from: 'A', to: 'D', label: '8.5cm' }, { from: 'B', to: 'O', dashed: true },
        ];
        expectAccepted(spec, '下图是一个正方形。');
        const before = raw(spec);
        const svg = renderFigureSpec(before);
        expect(svg).not.toBeNull();
        expect(renderFigureSpec(before, '下图是一个正方形。')).toBe(svg);
        expect(raw(spec)).toBe(before);
    });

    it('闭合边和多处共线点同样只在检查时简化', () => {
        const spec = geometry([[20, 50], [20, 20], [50, 20], [80, 20], [80, 80], [20, 80]]);
        expectAccepted(spec, '下图是一个正方形。');
        spec.points[3].x = 90;
        expectConflict(spec, '下图是一个正方形。');
    });

    it.each([
        ['正方形', 'square', [{ from: 'A', to: 'B', label: '5cm' }, { from: 'B', to: 'C', label: '6cm' }]],
        ['长方形', 'rectangle', [{ from: 'A', to: 'B', label: '5cm' }, { from: 'D', to: 'C', label: '6cm' }]],
        ['平行四边形', 'parallelogram', [{ from: 'B', to: 'C', label: '5cm' }, { from: 'A', to: 'D', label: '6cm' }]],
    ] as const)('%s的完整等长边标注矛盾时回退', (name, shape, segments) => {
        const spec = geometry(coordinates[shape]);
        spec.segments = [...segments];
        expectConflict(spec, `下图是一个${name}。`);
    });

    it('等长比较支持单位换算但保留原文，不用坐标比例改写长度', () => {
        const spec = geometry(coordinates.rectangle);
        spec.segments = [
            { from: 'A', to: 'B', label: '1分米' }, { from: 'C', to: 'D', label: '10cm' },
            { from: 'B', to: 'C', label: '20cm' }, { from: 'D', to: 'A', label: '2分米' },
            { from: 'A', to: 'C', label: '未知' },
        ];
        expectAccepted(spec, '下图是一个长方形。');
        const svg = renderFigureSpec(raw(spec), '下图是一个长方形。');
        expect(svg).toContain('1分米');
        expect(svg).toContain('10cm');
    });

    it('重复整边的标注都参与检查，未知值不能掩盖矛盾', () => {
        const spec = geometry(coordinates.square);
        spec.segments = [
            { from: 'A', to: 'B', label: '5cm' }, { from: 'B', to: 'A', label: 'x' },
            { from: 'A', to: 'B', label: '6cm' },
        ];
        expectConflict(spec, '下图是一个正方形。');
    });

    it('无单位长度不和有单位长度比较，未知表达式不求值', () => {
        const spec = geometry(coordinates.square);
        spec.segments = [
            { from: 'A', to: 'B', label: '5' }, { from: 'B', to: 'C', label: '6cm' },
            { from: 'C', to: 'D', label: 'x+2' }, { from: 'D', to: 'A', label: '3+3' },
        ];
        expectAccepted(spec, '下图是一个正方形。');
    });

    it('小幅坐标误差容许通过，明显斜角或边长差仍拒绝', () => {
        const nearSquare = geometry([[20, 20], [80, 20.2], [80.2, 80], [20, 80]]);
        expectAccepted(nearSquare, '下图是一个正方形。');
        expectConflict(geometry([[20, 20], [80, 25], [80, 80], [20, 80]]), '下图是一个正方形。');
        expectConflict(geometry([[20, 20], [80, 20], [80, 78], [20, 78]]), '下图是一个正方形。');
    });

    it('菱形不能因四边等长而充当正方形', () => {
        const spec = geometry([[50, 15], [80, 50], [50, 85], [20, 50]]);
        expectConflict(spec, '下图是一个正方形。');
        expectAccepted(spec, '下图是一个平行四边形。');
    });

    it.each(['0cm', '-2cm'])('明确完整边长不能是%s', (label) => {
        const spec = geometry(coordinates.triangle);
        spec.segments = [{ from: 'A', to: 'B', label }];
        expectConflict(spec, '下图是一个三角形。');
    });

    it.each([
        '下图是一个正方形吗？', '请证明下图是一个正方形。', '若下图是一个正方形，求面积。',
        '下图是一个正方形。这个说法正确吗？', '下图是一个正方形，求阴影部分的面积。',
        '比较正方形和长方形的面积。', '一张正方形纸裁成旗帜。',
    ])('没有确定的整体形状声明时不推断：%s', (question) => {
        expectAccepted(geometry(coordinates.rectangle), question);
    });

    it('多个多边形、圆或外部独立图元不强行对应成单个主图', () => {
        const multiple = geometry(coordinates.rectangle);
        multiple.polygons.push({ points: ['A', 'B', 'C'] });
        const circle = geometry(coordinates.rectangle);
        circle.points.push({ id: 'O', x: 50, y: 50 });
        circle.circles.push({ center: 'O', radius: 10 });
        const external = geometry(coordinates.rectangle);
        external.points.push({ id: 'E', x: 5, y: 5 }, { id: 'F', x: 10, y: 10 });
        external.segments.push({ from: 'E', to: 'F' });
        const noPolygon = geometry(coordinates.rectangle);
        noPolygon.polygons = [];
        noPolygon.segments = [{ from: 'A', to: 'B' }];
        for (const spec of [multiple, circle, external, noPolygon]) {
            expectAccepted(spec, '下图是一个正方形。');
        }
    });

    it('没有 polygon 时，单个闭合线段环也参与主图形状校验', () => {
        const square = segmentGeometry(coordinates.square, [[0, 1], [2, 3], [1, 2], [3, 0]]);
        const rectangle = segmentGeometry(coordinates.rectangle, [[2, 1], [0, 3], [3, 2], [1, 0]]);
        const triangle = segmentGeometry(coordinates.triangle, [[1, 2], [0, 1], [2, 0]]);
        expectAccepted(square, '下图是一个正方形。');
        expectConflict(rectangle, '下图是一个正方形。');
        expectAccepted(rectangle, '下图是一个长方形。');
        expectAccepted(triangle, '下图是一个三角形。');
    });

    it('闭合线段顺序可打乱，内部虚线辅助线不改变主图判断', () => {
        const spec = segmentGeometry(coordinates.square, [[2, 3], [0, 1], [3, 0], [1, 2]], [[0, 2], [1, 3]]);
        spec.segments[0].label = '5cm';
        spec.segments[1].label = '5cm';
        expectAccepted(spec, '下图是一个正方形。');
    });

    it('多环、开链或额外实线无法明确主图时保守跳过', () => {
        const twoCycles = segmentGeometry([
            ...coordinates.square,
            [10, 10], [30, 10], [30, 30], [10, 30],
        ], [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]]);
        const open = segmentGeometry(coordinates.rectangle, [[0, 1], [1, 2], [2, 3]]);
        const external = segmentGeometry(coordinates.square, [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]]);
        for (const spec of [twoCycles, open, external]) {
            expectAccepted(spec, '下图是一个正方形。');
        }
    });

    it('不把立体声明强加给平面图，明确三角形子类型仍须符合坐标', () => {
        expectAccepted(geometry(coordinates.rectangle), '下图是一个正方体。');
        expectConflict(geometry(coordinates.triangle), '下图是一个等边三角形。');
        expectAccepted(geometry(coordinates.triangle), '下图是一个等腰三角形。');
    });

    it('旧 SVG 保留完整回退，没有可用旧图时不输出冲突图', () => {
        const spec = raw(geometry(coordinates.rectangle));
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有配图</text></svg>';
        expect(parseFigure('true', legacy, spec, '下图是一个正方形。')).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, '下图是一个正方形。')).toEqual({ hasFigure: true, figureSvg: null });
    });
});

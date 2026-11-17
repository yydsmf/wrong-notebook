import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { validateFigureCircleNamedRelations } from '@/lib/figure-named-relations';
import { parseFigureSpec, type FigureSpec } from '@/lib/figure-spec';

type CircleGeometrySpec = Extract<FigureSpec, { type: 'circle_geometry' }>;
const validateCircleRelations = (spec: unknown, question: string) =>
    validateFigureCircleNamedRelations(spec as CircleGeometrySpec, question);

const raw = (value: unknown) => JSON.stringify(value);
const points = [
    { id: 'a', x: 20, y: 80, label: 'A' },
    { id: 'b', x: 50, y: 20, label: 'B' },
    { id: 'c', x: 80, y: 80, label: 'C' },
    { id: 'd', x: 20, y: 20, label: 'D' },
    { id: 'e', x: 80, y: 20, label: 'E' },
];
const geometry = (segments: Array<{ from: string; to: string; dashed?: boolean }> = [], angles: Array<{
    vertex: string; from: string; to: string; style?: 'arc' | 'right'; label?: string;
}> = [], figurePoints = points) => ({ type: 'basic_geometry', points: figurePoints, segments, angles });
const grade = (spec: unknown, question: string, legacy: string | null = null) => parseFigure('true', legacy, raw(spec), question);

describe('题干点名与线段、角关系', () => {
    it('连接AB、线段AB和AB长度要求图中存在对应线段', () => {
        const good = geometry([{ from: 'a', to: 'b' }]);
        expect(grade(good, '如图，连接AB。').figureSvg).not.toBeNull();
        expect(grade(good, '求线段AB的长度。').figureSvg).not.toBeNull();
        expect(grade(geometry([{ from: 'a', to: 'c' }]), '如图，连接AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('识别“连接点A和点B”等常见的双点连接表达', () => {
        const spec = geometry([{ from: 'a', to: 'b' }]);
        expect(grade(spec, '请连接点A和点B。').figureSvg).not.toBeNull();
        expect(grade(spec, 'connect A and B.').figureSvg).not.toBeNull();
        expect(grade(geometry([{ from: 'a', to: 'c' }]), '请连接点A和点B。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('多边形边界也算作题干引用的线段', () => {
        const polygonPoints = [
            { id: 'a', x: 20, y: 80, label: 'A' }, { id: 'b', x: 20, y: 20, label: 'B' },
            { id: 'c', x: 80, y: 80, label: 'C' }, { id: 'd', x: 80, y: 20, label: 'D' },
        ];
        const square = { ...geometry([], [], polygonPoints), polygons: [{ points: ['a', 'b', 'd', 'c'] }] };
        expect(grade(square, '求边AB的长度。').figureSvg).not.toBeNull();
        expect(grade(square, '连接AD。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('明确关系中的已知点不能与缺失点组成貌似有效的图形', () => {
        const labelled = [points[0]!, points[2]!];
        const spec = geometry([{ from: 'a', to: 'c' }], [], labelled);
        expect(grade(spec, '如图，连接AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(geometry([{ from: 'a', to: 'c' }], [], labelled), '∠ABC。')).toEqual({ hasFigure: true, figureSvg: null });

        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧图</text></svg>';
        expect(grade(spec, '如图，连接AB。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('部分线段名称缺点时拒绝，完全无对应点的文字仍保守跳过', () => {
        const relationPoints = [points[0]!, points[1]!];
        const spec = geometry([{ from: 'a', to: 'b' }], [], relationPoints);
        expect(grade(spec, 'AB∥DE。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '连接XY。').figureSvg).not.toBeNull();
    });

    it('∠ABC按B为顶点核对两条射线，反向端点也允许', () => {
        const good = geometry([{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }]);
        expect(grade(good, '图中有∠ABC。').figureSvg).not.toBeNull();
        expect(grade(good, '图中有∠CBA。').figureSvg).not.toBeNull();
        expect(grade(geometry([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]), '图中有∠ABC。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('∠ABC为直角时核对坐标垂直关系，直角标记不是唯一依据', () => {
        const rightPoints = [
            { id: 'a', x: 20, y: 20, label: 'A' }, { id: 'b', x: 20, y: 80, label: 'B' },
            { id: 'c', x: 80, y: 80, label: 'C' },
        ];
        const right = geometry([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], [], rightPoints);
        expect(grade(right, '∠ABC为直角。').figureSvg).not.toBeNull();
        const obliquePoints = [...rightPoints.slice(0, 2), { id: 'c', x: 80, y: 60, label: 'C' }];
        expect(grade(geometry([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], [], obliquePoints), '∠ABC为直角。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('平行和垂直关系核对两条线段的坐标方向', () => {
        const relationPoints = [
            { id: 'a', x: 20, y: 80, label: 'A' }, { id: 'b', x: 50, y: 80, label: 'B' },
            { id: 'c', x: 80, y: 50, label: 'C' }, { id: 'd', x: 20, y: 20, label: 'D' },
            { id: 'e', x: 50, y: 20, label: 'E' },
        ];
        const parallel = geometry([{ from: 'a', to: 'b' }, { from: 'd', to: 'e' }], [], relationPoints);
        expect(grade(parallel, 'AB∥DE。').figureSvg).not.toBeNull();
        expect(grade(parallel, 'AB⊥DE。')).toEqual({ hasFigure: true, figureSvg: null });
        const perpendicularPoints = [
            { id: 'a', x: 20, y: 20, label: 'A' }, { id: 'b', x: 20, y: 80, label: 'B' },
            { id: 'c', x: 80, y: 80, label: 'C' },
        ];
        const perpendicular = geometry([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], [], perpendicularPoints);
        expect(grade(perpendicular, '线段AB与BC垂直。').figureSvg).not.toBeNull();
    });

    it('AB=AC在图形语境下要求两条引用线段，但不按坐标比例推断长度相等', () => {
        const spec = geometry([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]);
        expect(grade(spec, '三角形ABC中，AB=AC。').figureSvg).not.toBeNull();
        expect(grade(geometry([{ from: 'a', to: 'b' }]), '三角形ABC中，AB=AC。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('无法解析点名、非几何类型和没有明确关系时保持保守', () => {
        expect(grade(geometry([{ from: 'a', to: 'b' }]), '求变量AB的值。').figureSvg).not.toBeNull();
        expect(grade(geometry([{ from: 'a', to: 'b' }]), '求图中某条线段的长度。').figureSvg).not.toBeNull();
        expect(grade({ type: 'table', headers: ['AB'], rows: [['x']] }, '连接AB。').figureSvg).not.toBeNull();
    });

    it('关系冲突保留完整旧SVG，没有旧图则不生成新图', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧图</text></svg>';
        const spec = geometry([{ from: 'a', to: 'c' }]);
        expect(grade(spec, '连接AB。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(spec, '连接AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });
});

const basicCircleGeometry = (overrides: Record<string, unknown> = {}) => ({
    ...geometry([
        { from: 'center', to: 'a' }, { from: 'center', to: 'b' },
        { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' },
    ], [], [
        { id: 'center', x: 50, y: 50, label: 'O' },
        { id: 'a', x: 80, y: 50, label: 'A' },
        { id: 'b', x: 50, y: 20, label: 'B' },
        { id: 'c', x: 20, y: 50, label: 'C' },
    ]),
    circles: [{ center: 'center', radius: 30 }],
    ...overrides,
});

const twoCircleBasicGeometry = (overrides: Record<string, unknown> = {}) => ({
    type: 'basic_geometry',
    points: [
        { id: 'o', x: 65, y: 50, label: 'O' },
        { id: 'p', x: 25, y: 50, label: 'P' },
        { id: 'a', x: 25, y: 80, label: 'A' },
        { id: 'b', x: 25, y: 20, label: 'B' },
    ],
    segments: [{ from: 'a', to: 'b' }],
    polygons: [],
    circles: [
        { center: 'o', radius: 30, label: '圆O' },
        { center: 'p', radius: 30, label: '圆P' },
    ],
    angles: [],
    labels: [],
    ...overrides,
});

const concentricGeometry = (overrides: Record<string, unknown> = {}) => basicCircleGeometry({
    points: [
        { id: 'center', x: 50, y: 50, label: 'O' },
        { id: 'a', x: 90, y: 50, label: 'A' },
        { id: 'b', x: 50, y: 10, label: 'B' },
        { id: 'c', x: 10, y: 50, label: 'C' },
        { id: 'd', x: 70, y: 50, label: 'D' },
    ],
    segments: [
        ...basicCircleGeometry().segments,
        { from: 'center', to: 'd' },
    ],
    circles: [
        { center: 'center', radius: 20, label: '内圆' },
        { center: 'center', radius: 40, label: '外圆' },
    ],
    ...overrides,
});

describe('通用几何复合图的有限圆关系', () => {
    it.each([
        '圆O中，半径OA。', '圆O中，半径AO。', '弦AB。', '弦AC。', '直径CA。',
        'AB是弦。', 'AC is a diameter.', 'OA is the radius.',
        '圆心角AOB。', '圆周角ACB。', 'central angle AOB.', 'inscribed angle ACB.',
        '∠AOB为圆心角。', '∠ACB是圆周角。',
    ])('正确圆心、圆周点与实际线段可通过：%s', (question) => {
        expect(grade(basicCircleGeometry(), question).figureSvg).not.toBeNull();
    });

    it.each(['半径OA。', '半径AO。', 'OA是半径。'])('缺少实际半径线段时回退：%s', (question) => {
        const spec = basicCircleGeometry({ segments: [{ from: 'a', to: 'b' }] });
        expect(grade(spec, question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('线段一端必须是该圆结构中明确的圆心，不能用附近点冒充', () => {
        const spec = basicCircleGeometry({
            points: [...basicCircleGeometry().points, { id: 'p', x: 50, y: 55, label: 'P' }],
            circles: [{ center: 'p', radius: 30 }],
        });
        expect(grade(spec, '半径OA。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '连接OA。').figureSvg).not.toBeNull();
    });

    it.each(['半径OB。', '弦AB。', '圆心角AOB。', '圆周角ACB。'])('明确圆周点不能落在圆内部：%s', (question) => {
        const spec = basicCircleGeometry({
            points: basicCircleGeometry().points.map((point) => point.id === 'b' ? { ...point, y: 30 } : point),
        });
        expect(grade(spec, question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('弦必须存在，普通弦不能冒充直径或半径', () => {
        const missingChord = basicCircleGeometry({ segments: [{ from: 'center', to: 'a' }] });
        expect(grade(missingChord, '弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(basicCircleGeometry(), '直径AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(basicCircleGeometry(), '半径AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it.each(['圆心角ABC。', '圆周角AOB。', '∠ABC为圆心角。', '∠AOB是圆周角。'])('普通角的线段存在也不能冒充错误圆角：%s', (question) => {
        expect(grade(basicCircleGeometry(), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it.each(['central angle ACB.', 'inscribed angle AOB.'])('英文圆心角和圆周角也核对顶点类型：%s', (question) => {
        expect(grade(basicCircleGeometry(), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('角标不能代替缺少的两条实际射线', () => {
        const spec = basicCircleGeometry({
            segments: [{ from: 'center', to: 'a' }],
            angles: [{ vertex: 'center', from: 'a', to: 'b', style: 'arc' }],
        });
        expect(grade(spec, '圆心角AOB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('多边形明确画出的边也可表达圆的半径和弦', () => {
        const spec = basicCircleGeometry({ segments: [], polygons: [{ points: ['center', 'a', 'b'] }] });
        expect(grade(spec, '半径OA，弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆心角AOB。').figureSvg).not.toBeNull();
    });

    it('相邻圆心角、圆周角和普通角各自保持类型，不串用前后语境', () => {
        const spec = basicCircleGeometry();
        expect(grade(spec, '圆心角AOB，圆周角ACB。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆心角AOB，∠ACB。').figureSvg).not.toBeNull();
        expect(grade(spec, '∠AOB，圆周角ACB。').figureSvg).not.toBeNull();
        expect(grade(spec, '∠AOB是一个圆心角；∠ACB是一个圆周角。').figureSvg).not.toBeNull();
    });

    it('对小幅坐标舍入保留容差，不移动原始点来修复圆周关系', () => {
        const spec = basicCircleGeometry({
            points: basicCircleGeometry().points.map((point) => point.id === 'b' ? { ...point, y: 20.01 } : point),
        });
        const before = raw(spec);
        expect(grade(spec, '弦AB。').figureSvg).not.toBeNull();
        expect(raw(spec)).toBe(before);
        const visibleGap = { ...spec, points: spec.points.map((point) => point.id === 'b' ? { ...point, y: 21 } : point) };
        expect(grade(visibleGap, '弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('部分点名缺失时回退，完全无对应点名时不猜测关系', () => {
        const spec = basicCircleGeometry({
            points: basicCircleGeometry().points.filter((point) => point.id !== 'b'),
            segments: [{ from: 'center', to: 'a' }, { from: 'a', to: 'c' }],
        });
        expect(grade(spec, '半径OB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '弦XY。').figureSvg).not.toBeNull();
    });

    it('没有对应圆结构时拒绝明确半径，弧和扇形方向仍保守跳过', () => {
        expect(grade(basicCircleGeometry({ circles: [] }), '半径AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(basicCircleGeometry(), '优弧ADB，扇形AOC。').figureSvg).not.toBeNull();
        expect(grade(basicCircleGeometry(), '优弧ADX，扇形AXC。').figureSvg).not.toBeNull();
        expect(grade(basicCircleGeometry(), '求圆的面积。').figureSvg).not.toBeNull();
    });

    it('多圆时题干指定圆心只校验对应圆，避免把另一圆的弦误判为当前圆的弦', () => {
        const spec = twoCircleBasicGeometry();
        expect(grade(spec, '圆P中，弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '在圆P内，弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, 'in circle P, chord AB.').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆符号⊙的前置和后置圆心归属不能漏掉', () => {
        const spec = twoCircleBasicGeometry();
        expect(grade(spec, '⊙P中，弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '⊙O中，弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, 'AB是⊙P的弦。').figureSvg).not.toBeNull();
        expect(grade(spec, 'AB是⊙O的弦。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆周角的指定圆心范围也不能被另一圆的三个圆周点冒充', () => {
        const spec = twoCircleBasicGeometry({
            points: [
                { id: 'o', x: 65, y: 50, label: 'O' },
                { id: 'p', x: 25, y: 50, label: 'P' },
                { id: 'a', x: 25, y: 80, label: 'A' },
                { id: 'b', x: 25, y: 20, label: 'B' },
                { id: 'c', x: 55, y: 50, label: 'C' },
            ],
            segments: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }],
        });
        expect(grade(spec, '圆P中，圆周角ACB。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，圆周角ACB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('没有明确指定圆时保留兼容行为，未知圆心引用则回退', () => {
        const spec = twoCircleBasicGeometry();
        expect(grade(spec, '弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆X中，弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('同心圆按明确圆心绑定，仍允许在同一圆心下由半径决定可用圆', () => {
        const spec = twoCircleBasicGeometry({
            points: [
                { id: 'o', x: 50, y: 50, label: 'O' },
                { id: 'a', x: 80, y: 50, label: 'A' },
                { id: 'b', x: 20, y: 50, label: 'B' },
            ],
            segments: [{ from: 'a', to: 'b' }],
            circles: [
                { center: 'o', radius: 20, label: '内圆' },
                { center: 'o', radius: 30, label: '外圆' },
            ],
        });
        expect(grade(spec, '圆O中，直径AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '外圆中，直径AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '内圆中，直径AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆名归属可以在圆心点没有可见标签时仍然绑定到对应圆', () => {
        const spec = twoCircleBasicGeometry({
            points: [
                { id: 'o', x: 50, y: 50 },
                { id: 'a', x: 70, y: 50, label: 'A' },
                { id: 'b', x: 30, y: 50, label: 'B' },
            ],
            segments: [{ from: 'a', to: 'b' }],
            circles: [{ center: 'o', radius: 20, label: '圆A' }],
        });
        expect(grade(spec, '圆A中，直径AB。').figureSvg).not.toBeNull();
    });

    it.each(['半径OD，弦AB', '半径OD，直径AC', '半径OD，圆心角AOB', '半径OD，圆周角ACB'])(
        '内圆作用域延续到逗号后的关系，不借用外圆通过：%s', (relations) => {
            const spec = concentricGeometry();
            expect(parseFigureSpec(raw(spec))).not.toBeNull();
            expect(grade(spec, '外圆中，弦AB。').figureSvg).not.toBeNull();
            expect(parseFigureSpec(raw(spec), `内圆中，${relations}。`)).toBeNull();
            expect(grade(spec, `内圆中，${relations}。`)).toEqual({ hasFigure: true, figureSvg: null });
        },
    );

    it('内外圆切换时后续关系跟随最新的明确圆名', () => {
        const spec = concentricGeometry();
        expect(parseFigureSpec(raw(spec), '内圆中，半径OD，外圆中，弦AB，直径AC。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '外圆中，弦AB，内圆中，半径OD，直径AC。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '内圆的半径OD，弦AB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '在内圆中，半径OD，弦AB。')).toBeNull();
        for (const separator of ['。', '；', '\n', '. ']) {
            expect(parseFigureSpec(raw(spec), `内圆中，半径OD${separator}弦AB。`), separator).not.toBeNull();
        }
    });

    it('圆名不能通过部分字符串、不同大小写或普通多圆提及来绑定', () => {
        const spec = twoCircleBasicGeometry();
        for (const question of ['圆P与圆O相交，弦AB。', 'circle P intersects circle O, chord AB.', 'The circles overlap, chord AB.', '圆O。弦AB。', 'circle O. chord AB.']) {
            expect(parseFigureSpec(raw(spec), question), question).not.toBeNull();
        }
        expect(parseFigureSpec(raw(spec), '圆P1中，弦AB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '圆p中，弦AB。')).toBeNull();
    });

    it('共享圆心但重名的两个圆无法唯一对应时回退，不按端点挑选半径', () => {
        const spec = concentricGeometry({ circles: [
            { center: 'center', radius: 20, label: '目标圆' },
            { center: 'center', radius: 40, label: '目标圆' },
        ] });
        expect(parseFigureSpec(raw(spec))).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '目标圆中，弦AB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '圆O中，弦AB。')).not.toBeNull();
    });

    it('完整圆名按字面匹配，保留空格和正则特殊字符', () => {
        const spec = concentricGeometry({ circles: [
            { center: 'center', radius: 20, label: '内圆(1)' },
            { center: 'center', radius: 40, label: 'outer circle' },
        ] });
        expect(parseFigureSpec(raw(spec), '内圆(1)中，弦AB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'in the outer circle, chord AB.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'in the outer circle, radius OD.')).toBeNull();
    });

    it('未标圆名时不根据相对半径给圆补写内外归属', () => {
        const spec = concentricGeometry({ circles: [
            { center: 'center', radius: 20 }, { center: 'center', radius: 40 },
        ] });
        expect(parseFigureSpec(raw(spec), '内圆中，弦AB。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '外圆中，半径OD。')).not.toBeNull();
    });

    it('图组内的圆名独立校验，任一子图冲突保留完整旧图且不改输入', () => {
        const spec = concentricGeometry();
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: spec }, { label: '乙', figure: spec },
        ] };
        const question = '图甲中：外圆中，弦AB；图乙中：内圆中，半径OD，弦AB。';
        const before = raw(group);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整同心圆图</text></svg>';
        expect(parseFigureSpec(before)).not.toBeNull();
        expect(parseFigureSpec(before, question)).toBeNull();
        expect(grade(group, question, legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(raw(group)).toBe(before);
    });

    it('明确图组子句按各自圆结构校验，任一错误使整组回退', () => {
        const good = basicCircleGeometry();
        const group = {
            type: 'figure_group',
            figures: [{ label: '甲', figure: good }, { label: '乙', figure: good }],
        };
        expect(grade(group, '图甲中：半径OA；图乙中：弦AB。').figureSvg).not.toBeNull();
        const invalid = { ...group, figures: [group.figures[0], { label: '乙', figure: basicCircleGeometry({ segments: [] }) }] };
        expect(grade(invalid, '图甲中：半径OA；图乙中：弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(group, '图甲中：半径OA；图乙中：弦XY。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆关系冲突沿用完整旧SVG，输入的点、线、圆保持不变', () => {
        const spec = basicCircleGeometry();
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧复合图</text></svg>';
        expect(grade(spec, '直径AB。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(raw(spec)).toBe(before);
    });
});

const circleGeometry = (overrides: Record<string, unknown> = {}) => ({
    type: 'circle_geometry',
    center: { id: 'center', x: 50, y: 50, label: 'O' },
    radius: 30,
    points: [
        { id: 'a', x: 80, y: 50, label: 'A' },
        { id: 'b', x: 50, y: 20, label: 'B' },
        { id: 'c', x: 20, y: 50, label: 'C' },
    ],
    radii: [{ to: 'a' }],
    chords: [{ from: 'a', to: 'b' }],
    diameters: [{ from: 'a', to: 'c' }],
    ...overrides,
});

const arcScopeGeometry = (arcType: 'minor' | 'major' = 'minor') => circleGeometry({
    arcs: [{ from: 'a', to: 'b', arcType }, { from: 'a', to: 'c', through: 'b' }],
    sectors: [{ from: 'a', to: 'b' }],
});

describe('题干点名与圆图的半径、弦、直径关系', () => {
    it.each(['半径OA', '弦AB', '直径AC', '圆心角AOB', '圆周角ACB'])(
        '专用圆图也核对指定圆心，圆周点名不能冒充圆心：%s', (relation) => {
            const spec = circleGeometry({
                radii: [{ to: 'a' }, { to: 'b' }],
                chords: [{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }],
            });
            expect(parseFigureSpec(raw(spec), `圆O中，${relation}。`)).not.toBeNull();
            expect(parseFigureSpec(raw(spec), `圆A中，${relation}。`)).toBeNull();
        },
    );

    it('分别核对半径、弦和直径，直径也可作为弦', () => {
        const spec = circleGeometry();
        expect(grade(spec, '圆O中，半径OA。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，半径AO。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，弦AB。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，弦AC。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，直径AC。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆O中，直径AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '圆O中，半径OB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('普通连接和长度表达可引用半径、弦或直径', () => {
        const spec = circleGeometry();
        expect(grade(spec, '连接OA。').figureSvg).not.toBeNull();
        expect(grade(spec, '求线段AB的长度。').figureSvg).not.toBeNull();
        expect(grade(spec, '求直径AC的长度。').figureSvg).not.toBeNull();
        expect(grade(spec, '连接BC。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('识别“AB是弦”和英文 chord、diameter、radius 表达', () => {
        const spec = circleGeometry();
        expect(grade(spec, 'AB是弦。').figureSvg).not.toBeNull();
        expect(grade(spec, 'AC is a diameter.').figureSvg).not.toBeNull();
        expect(grade(spec, 'OA is the radius.').figureSvg).not.toBeNull();
        expect(grade(spec, 'AB is a diameter.')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆心角要求圆心为顶点并存在两条半径，圆周角要求顶点在圆周且两条弦存在', () => {
        const central = circleGeometry({ radii: [{ to: 'a' }, { to: 'b' }] });
        expect(grade(central, '圆心角AOB。').figureSvg).not.toBeNull();
        expect(grade(central, '∠AOB为直角。').figureSvg).not.toBeNull();
        expect(grade(circleGeometry(), '圆心角AOB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(central, '圆周角AOB。')).toEqual({ hasFigure: true, figureSvg: null });

        const sector = circleGeometry({ radii: [], sectors: [{ from: 'a', to: 'b' }] });
        expect(grade(sector, '圆心角AOB。').figureSvg).not.toBeNull();
        expect(grade(sector, '圆心角AOC。')).toEqual({ hasFigure: true, figureSvg: null });

        const inscribed = circleGeometry({ radii: [], chords: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }] });
        expect(grade(inscribed, '圆周角ACB。').figureSvg).not.toBeNull();
        expect(grade(inscribed, '圆周角AOB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(inscribed, '圆心角AOB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆心角和圆周角的后置圆名仍必须匹配实际圆心与顶点类型', () => {
        const central = circleGeometry({ radii: [{ to: 'a' }, { to: 'b' }] });
        expect(grade(central, '∠AOB是⊙O的圆心角。').figureSvg).not.toBeNull();
        expect(grade(central, '∠AOB是⊙A的圆心角。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(central, 'central angle AOB of circle O.').figureSvg).not.toBeNull();
        expect(grade(central, 'central angle AOB of circle A.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(central, 'angle AOB is a central angle of circle O.').figureSvg).not.toBeNull();
        expect(grade(central, 'angle AOB is a central angle of circle A.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(basicCircleGeometry(), '∠AOB是⊙O的圆心角。').figureSvg).not.toBeNull();
        expect(grade(basicCircleGeometry(), '∠AOB是⊙A的圆心角。')).toEqual({ hasFigure: true, figureSvg: null });

        const inscribed = circleGeometry({ radii: [], chords: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }] });
        expect(grade(inscribed, '∠ACB是⊙O的圆周角。').figureSvg).not.toBeNull();
        expect(grade(inscribed, '∠AOB是⊙O的圆周角。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(inscribed, '∠ACB是⊙A的圆周角。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(inscribed, 'angle ACB is an inscribed angle of circle O.').figureSvg).not.toBeNull();
        expect(grade(inscribed, 'angle AOB is an inscribed angle of circle O.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(inscribed, '判断∠ACB是⊙O的圆心角。').figureSvg).not.toBeNull();
        expect(grade(inscribed, '∠ACB是⊙O的圆心角吗？').figureSvg).not.toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整圆角旧图</text></svg>';
        expect(grade(central, '∠AOB是⊙A的圆心角。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('普通具名角只在两条对应线段实际存在时通过', () => {
        const spec = circleGeometry({ radii: [{ to: 'a' }, { to: 'b' }] });
        expect(grade(spec, '∠AOB。').figureSvg).not.toBeNull();
        expect(grade(circleGeometry(), '∠AOB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('相邻圆心角和圆周角使用各自紧邻的语义，不串读后置关系', () => {
        const spec = circleGeometry({
            radii: [{ to: 'a' }, { to: 'b' }],
            chords: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }],
        });
        expect(grade(spec, '圆心角AOB，圆周角ACB。').figureSvg).not.toBeNull();
        expect(grade(spec, '∠AOB为圆心角；∠ACB是圆周角。').figureSvg).not.toBeNull();
        expect(grade(spec, '∠AOB是一个圆心角；∠ACB是一个圆周角。').figureSvg).not.toBeNull();
        expect(grade(spec, '圆周角AOB，圆心角ACB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '∠ACB为圆心角；∠AOB是圆周角。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '∠ACB是一个圆心角；∠AOB是一个圆周角。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, 'central angle AOB; inscribed angle ACB.').figureSvg).not.toBeNull();
        expect(grade(spec, 'central angle ACB; inscribed angle AOB.')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('角名后面的说明不能被当成点名，仍按前三个点校验', () => {
        const spec = circleGeometry({
            radii: [{ to: 'a' }, { to: 'b' }],
            chords: [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }],
        });
        expect(grade(spec, 'central angle AOB is 90 degrees.').figureSvg).not.toBeNull();
        expect(grade(spec, 'inscribed angle ACB is acute.').figureSvg).not.toBeNull();
        expect(grade(spec, 'central angle ACB is 90 degrees.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, 'inscribed angle AOB is acute.')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('圆图中明确点名关系不能静默遗漏缺失的圆周点', () => {
        const spec = circleGeometry({ points: [
            { id: 'a', x: 80, y: 50, label: 'A' },
            { id: 'c', x: 20, y: 50, label: 'C' },
        ], chords: [], diameters: [{ from: 'a', to: 'c' }] });
        expect(grade(spec, '弦AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '连接AO。').figureSvg).not.toBeNull();
        expect(grade(circleGeometry(), '弦XY。').figureSvg).not.toBeNull();
    });

    it('核对弧型、第三点方向、半圆和扇形的题干关系', () => {
        const arcItems = [
            { from: 'a', to: 'b', arcType: 'major' as const },
            { from: 'a', to: 'c', through: 'b' },
        ];
        const arcs = circleGeometry({
            arcs: arcItems,
            sectors: [{ from: 'a', to: 'b' }],
        });
        expect(grade(arcs, '优弧AB。').figureSvg).not.toBeNull();
        expect(grade(arcs, '弧AB。').figureSvg).not.toBeNull();
        expect(grade(arcs, '半圆AC。').figureSvg).not.toBeNull();
        expect(grade(arcs, '弧ABC。').figureSvg).not.toBeNull();
        expect(grade(arcs, '扇形AOB。').figureSvg).not.toBeNull();
        expect(grade(circleGeometry({ arcs: arcItems, sectors: [] }), '劣弧AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(arcs, '弧ACB。').figureSvg).not.toBeNull();
        expect(grade(arcs, '半圆AB。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(arcs, '扇形AOC。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(arcs, '扇形ABC。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('三点弧名按点是否落在实际弧段判断，不要求重复写through', () => {
        const spec = circleGeometry({
            points: [
                { id: 'a', x: 80, y: 50, label: 'A' },
                { id: 'b', x: 65, y: 75.980762, label: 'B' },
                { id: 'c', x: 75.980762, y: 65, label: 'C' },
                { id: 'd', x: 50, y: 20, label: 'D' },
            ],
            arcs: [{ from: 'a', to: 'b', arcType: 'minor' }],
            sectors: [],
        });
        expect(validateCircleRelations(spec, '弧ACB。')).toBe(true);
        expect(validateCircleRelations(spec, '弧ADB。')).toBe(false);

        const major = { ...spec, arcs: [{ from: 'a', to: 'b', arcType: 'major' as const }] };
        expect(validateCircleRelations(major, '弧ADB。')).toBe(true);
        expect(validateCircleRelations(major, '弧ACB。')).toBe(false);

        const directedByOtherPoint = { ...spec, arcs: [{ from: 'a', to: 'b', through: 'd' }] };
        expect(validateCircleRelations(directedByOtherPoint, '弧ADB。')).toBe(true);
        expect(validateCircleRelations(directedByOtherPoint, '弧ACB。')).toBe(false);
    });

    it.each(['弧AB', '优弧AB', '劣弧AB', '半圆AC', '弧ABC', '扇形AOB'])(
        '圆弧或扇形不能借用另一圆心通过：%s', (relation) => {
            const spec = arcScopeGeometry(relation.startsWith('优') ? 'major' : 'minor');
            expect(grade(spec, `圆O中，${relation}。`).figureSvg).not.toBeNull();
            expect(parseFigureSpec(raw(spec), `圆A中，${relation}。`)).toBeNull();
            expect(parseFigureSpec(raw(spec), `圆X中，${relation}。`)).toBeNull();
        },
    );

    it.each([
        ['arc AB', 'minor'], ['major arc AB', 'major'], ['minor arc AB', 'minor'],
        ['semicircle AC', 'minor'], ['sector AOB', 'minor'],
    ] as const)('英文圆范围同样约束 %s', (relation, arcType) => {
        const spec = arcScopeGeometry(arcType);
        expect(parseFigureSpec(raw(spec), `in circle O, ${relation}.`)).not.toBeNull();
        expect(parseFigureSpec(raw(spec), `in circle A, ${relation}.`)).toBeNull();
    });

    it('圆范围随逗号延续、在新圆心处切换，跨句不猜测归属', () => {
        const spec = arcScopeGeometry();
        expect(parseFigureSpec(raw(spec), '圆O中，弧AB，扇形AOB。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '圆O中，弧AB，圆A中，扇形AOB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '圆A的弧AB。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '圆A的扇形AOB。')).toBeNull();
        for (const separator of ['。', '；', '\n', '. ']) {
            expect(parseFigureSpec(raw(spec), `圆A${separator}弧AB。`), separator).not.toBeNull();
        }
    });

    it('弧和扇形的后置圆归属不能被忽略', () => {
        const spec = arcScopeGeometry();
        expect(parseFigureSpec(raw(spec), '弧AB属于⊙O。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB属于⊙A。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB在⊙O上。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB是⊙O的弧。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '圆O中，弧AB属于⊙A。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '扇形AOB属于⊙O。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '扇形AOB属于⊙A。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB是⊙O的劣弧。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB是⊙O的优弧。')).toBeNull();
        const majorArc = { ...spec, arcs: [{ from: 'a', to: 'b', arcType: 'major' as const }] };
        expect(parseFigureSpec(raw(majorArc), '弧AB是⊙O的优弧。')).not.toBeNull();
        expect(parseFigureSpec(raw(majorArc), '优弧AB是⊙O的劣弧。')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'arc AB belongs to circle O.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'arc AB belongs to circle A.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'arc AB is a minor arc of circle O.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'arc AB is a major arc of circle O.')).toBeNull();
        expect(parseFigureSpec(raw(majorArc), 'arc AB is a major arc of circle O.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '判断弧AB属于⊙A吗？')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '弧AB不属于⊙A。')).not.toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整圆弧旧图</text></svg>';
        expect(grade(spec, '弧AB属于⊙A。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(grade(spec, '弧AB属于⊙A。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('英文名称后续说明不吞入点名，仍核对优劣弧和实际扇形', () => {
        const spec = arcScopeGeometry();
        expect(parseFigureSpec(raw(spec), 'in circle O, minor arc AB has length 5 cm.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'in circle O, major arc AB has length 5 cm.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'in circle O, sector AOB has area 12.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'in circle O, sector AOC has area 12.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'in circle A, arc AB has length 5 cm.')).toBeNull();
    });

    it('严格弧名保留数字、下标和撇号，不截取缺失点或过长名称', () => {
        const base = arcScopeGeometry();
        const spec = { ...base, points: base.points.map((point, index) => ({ ...point, label: ['A1', 'B₂', 'C′'][index] })) };
        expect(parseFigureSpec(raw(spec), '圆O中，弧A1B₂C′。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'in circle O, sector A1 O B₂ has area 12.')).not.toBeNull();
        expect(parseFigureSpec(raw(base), '弧AX。')).toBeNull();
        expect(parseFigureSpec(raw(base), 'sector AOB1 has area 12.')).toBeNull();
        expect(parseFigureSpec(raw(base), '弧XY。')).not.toBeNull();
        expect(parseFigureSpec(raw(base), '弧ABCD。')).not.toBeNull();
    });

    it('空格分隔的四点长名称也不能截成弧或扇形，英文说明仍可跟在有效名称后', () => {
        const base = arcScopeGeometry();
        const spec = { ...base, points: [...base.points, { id: 'd', x: 50, y: 80, label: 'D' }] };
        for (const question of ['弧 A B D C。', 'arc A B D C.', '扇形 A O C B。', 'sector A O C B.']) {
            expect(parseFigureSpec(raw(spec), question), question).not.toBeNull();
        }
        expect(parseFigureSpec(raw(spec), 'arc A B C has length 5.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'arc A B D has length 5.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'sector A O B has area 5.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'sector A O C has area 5.')).toBeNull();
    });

    it('三点弧名的中间点必须在圆周，不能把圆心的角度位置当作弧内点', () => {
        const spec = circleGeometry({ arcs: [{ from: 'b', to: 'c', arcType: 'major' }] });
        expect(parseFigureSpec(raw(spec), '弧BAC。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '弧BOC。')).toBeNull();
    });

    it.each(['arcs', 'sectors'] as const)('省略弧型的%s按实际劣弧校验，不能借题干第三点改换方向', (collection) => {
        const base = circleGeometry();
        const spec = {
            ...base,
            points: [...base.points, { id: 'd', x: 71.213203, y: 28.786797, label: 'D' }],
            arcs: [], sectors: [],
            [collection]: [{ from: 'a', to: 'b' }],
        };
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧弧图</text></svg>';
        expect(parseFigureSpec(before)).not.toBeNull();
        expect(parseFigureSpec(before, '弧ADB。')).not.toBeNull();
        expect(parseFigureSpec(before, '弧BDA。')).not.toBeNull();
        expect(parseFigureSpec(before, '弧ACB。')).toBeNull();
        expect(parseFigureSpec(before, '弧BCA。')).toBeNull();
        expect(grade(spec, '弧ACB。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigureSpec(raw({ ...spec, [collection]: [{ from: 'a', to: 'b', through: 'c' }] }), '弧ACB。')).not.toBeNull();
        expect(parseFigureSpec(raw({ ...spec, [collection]: [{ from: 'a', to: 'b', arcType: 'major' }] }), '弧ACB。')).not.toBeNull();
        expect(raw(spec)).toBe(before);
    });

    it('重复弧点名不能因解析被跳过而当作有效关系', () => {
        const spec = arcScopeGeometry();
        for (const name of ['ABA', 'AAB', 'ABB', 'AA']) {
            expect(parseFigureSpec(raw(spec), `圆O中，弧${name}。`), name).toBeNull();
        }
        expect(grade(basicCircleGeometry(), '弧ABA。').figureSvg).not.toBeNull();
    });

    it('通用几何不强行校验弧和扇形，但后续半径仍受同一圆范围约束', () => {
        const spec = basicCircleGeometry();
        expect(grade(spec, '圆X中，弧AB、扇形AOB。').figureSvg).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '圆X的弧AB，半径OA。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '圆X的扇形AOB，半径OA。')).toBeNull();
    });

    it('弧圆心冲突使整个图组回退，保留完整旧SVG且不修改结构', () => {
        const spec = arcScopeGeometry();
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: spec }, { label: '乙', figure: spec },
        ] };
        const before = raw(group);
        const question = '图甲中：圆O中，弧AB；图乙中：圆A中，扇形AOB。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整弧与扇形图</text></svg>';
        expect(parseFigureSpec(before)).not.toBeNull();
        expect(parseFigureSpec(before, question)).toBeNull();
        expect(grade(group, question, legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(group, question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(raw(group)).toBe(before);
    });

    it('冲突时沿用旧配图，没有旧图则不返回新图', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧圆图</text></svg>';
        const spec = circleGeometry();
        expect(grade(spec, '直径AB。', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(spec, '直径AB。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('没有明确的圆图关系时保持保守，不把普通文字当成约束', () => {
        const spec = circleGeometry();
        expect(grade(spec, '求圆的面积。').figureSvg).not.toBeNull();
        expect(grade(spec, '求变量AB的值。').figureSvg).not.toBeNull();
    });
});

const angleBindingGeometry = (right: boolean, basic = false) => {
    const spec = circleGeometry({
        points: [
            { id: 'a', x: 80, y: 50, label: 'A' },
            { id: 'b', x: right ? 50 : 65, y: right ? 20 : 24.019238, label: 'B' },
            { id: 'c', x: 20, y: 50, label: 'C' },
        ],
        radii: [{ to: 'a' }, { to: 'b' }],
        chords: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
        diameters: [{ from: 'a', to: 'c' }],
    });
    return basic ? basicCircleGeometry({
        points: [spec.center, ...spec.points],
        segments: [
            { from: 'center', to: 'a' }, { from: 'center', to: 'b' },
            { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' },
        ],
    }) : spec;
};

describe.each([false, true])('直角条件与角名绑定（通用几何：%s）', (basic) => {
    it.each(['∠AOB=90°。', '∠AOB为90.0度。', '90°∠AOB。', '90 degrees angle AOB.', 'angle AOB is 90 degrees.', 'angle AOB measures 90.00 degrees.'])('明确的直角度数必须核对实际坐标：%s', (question) => {
        expect(parseFigureSpec(raw(angleBindingGeometry(true, basic)), question)).not.toBeNull();
        expect(parseFigureSpec(raw(angleBindingGeometry(false, basic)), question)).toBeNull();
    });

    it.each(['直角∠AOB。', 'right angle AOB.'])('角名前紧邻的直角声明也要核对：%s', (question) => {
        expect(parseFigureSpec(raw(angleBindingGeometry(true, basic)), question)).not.toBeNull();
        expect(parseFigureSpec(raw(angleBindingGeometry(false, basic)), question)).toBeNull();
    });

    it.each([
        '∠AOB不是直角。', '∠AOB是否为直角？', '∠AOB为直角吗？',
        'angle AOB is not a right angle.', 'Is angle AOB a right angle?',
        'Is it true that angle AOB is a right angle?', '证明∠AOB为直角。',
        '若∠AOB为直角。', '∠AOB=90.5°。', '∠AOB=90.5度。', '∠AOB=190°。',
        '190°∠AOB。', '190 degrees angle AOB.',
    ])('否定、提问、待证明和其它度数不能当作已知直角：%s', (question) => {
        expect(parseFigureSpec(raw(angleBindingGeometry(false, basic)), question)).not.toBeNull();
    });

    it('只核对对应角的直角条件，不从后一个角或后一句借用', () => {
        const spec = angleBindingGeometry(false, basic);
        expect(parseFigureSpec(raw(spec), '∠AOB，∠ABC为直角。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '∠AOB且∠ABC为直角。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '∠AOB。∠ABC为直角。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'angle AOB and angle ABC is a right angle.')).not.toBeNull();
    });

    it('角名尾部边界不截取空格分隔的四点名称', () => {
        expect(parseFigureSpec(raw(angleBindingGeometry(false, basic)), '∠A O B C为直角。')).not.toBeNull();
        expect(parseFigureSpec(raw(angleBindingGeometry(false, basic)), 'angle A O B C is a right angle.')).not.toBeNull();
    });

    it('同一个角的类型与直角条件可连续声明，但不能影响另一个角', () => {
        const right = raw(angleBindingGeometry(true, basic));
        const oblique = raw(angleBindingGeometry(false, basic));
        for (const question of ['∠AOB为圆心角且为直角。', 'angle AOB is a central angle and a right angle.']) {
            expect(parseFigureSpec(right, question), question).not.toBeNull();
            expect(parseFigureSpec(oblique, question), question).toBeNull();
        }
    });

    it('明确直角冲突保留完整旧图，图组整体回退且不改输入点位', () => {
        const spec = angleBindingGeometry(false, basic);
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧角图</text></svg>';
        expect(grade(spec, 'angle AOB is 90 degrees.', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(spec, 'angle AOB is 90 degrees.')).toEqual({ hasFigure: true, figureSvg: null });
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: angleBindingGeometry(true, basic) },
            { label: '乙', figure: spec },
        ] };
        const question = '图甲中：∠AOB为直角；图乙中：∠AOB为90.0度。';
        expect(grade(group, question, legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(group, question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(raw(spec)).toBe(before);
    });
});

const circleSegmentTokenGeometry = (basic: boolean) => basic ? basicCircleGeometry({ segments: [
    { from: 'center', to: 'a' }, { from: 'a', to: 'b' }, { from: 'a', to: 'c' },
] }) : circleGeometry();

describe.each([false, true])('圆线段名称与说明边界（通用几何：%s）', (basic) => {
    it.each([
        ['radius OA has length 3 cm.', 'radius OB has length 3 cm.'],
        ['chord AB has length 4 cm.', 'chord BC has length 4 cm.'],
        ['diameter AC has length 6 cm.', 'diameter AB has length 6 cm.'],
        ['RADIUS O A has length 3 cm.', 'RADIUS O B has length 3 cm.'],
    ])('名称之后的英文说明不能取消关系校验：%s', (valid, invalid) => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        expect(parseFigureSpec(spec, valid)).not.toBeNull();
        expect(parseFigureSpec(spec, invalid)).toBeNull();
    });

    it.each([
        ['Given OA is a radius.', 'Given OB is a radius.'],
        ['The diagram shows AB is a chord.', 'The diagram shows BC is a chord.'],
        ['In circle O, AC is the diameter.', 'In circle O, AB is the diameter.'],
        ['已知OA是一条半径。', '已知OB是一条半径。'],
        ['已知AB是一条弦。', '已知BC是一条弦。'],
        ['已知AC是一条直径。', '已知AB是一条直径。'],
    ])('前面的说明不属于后置关系的点名：%s', (valid, invalid) => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        expect(parseFigureSpec(spec, valid)).not.toBeNull();
        expect(parseFigureSpec(spec, invalid)).toBeNull();
    });

    it('明确圆范围及缺失点不能因为说明文字被忽略', () => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        expect(parseFigureSpec(spec, 'in circle O, radius OA has length 3 cm.')).not.toBeNull();
        expect(parseFigureSpec(spec, 'in circle A, radius OA has length 3 cm.')).toBeNull();
        expect(parseFigureSpec(spec, 'in circle X, chord AB has length 3 cm.')).toBeNull();
        expect(parseFigureSpec(spec, 'radius OX has length 3 cm.')).toBeNull();
    });

    it('三点长名称不能截成两点，英文单词内部不能冒充关系关键词', () => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        for (const question of [
            'radius O B A has length 3 cm.', 'radius OBA has length 3 cm.',
            'O B A is a radius.', 'Given O B A is a radius.',
            'subradius OB has length 3 cm.', 'subdiameter AB has length 3 cm.',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
    });

    it('连续中英文关系逐项核对，保留数字下标和撇号点名', () => {
        const base = circleSegmentTokenGeometry(basic);
        expect(parseFigureSpec(raw(base), 'radius OA has length 3 cm, chord AB has length 4 cm.')).not.toBeNull();
        expect(parseFigureSpec(raw(base), 'radius OA has length 3 cm, diameter AB has length 4 cm.')).toBeNull();
        const spec = { ...base, points: base.points.map((point) => ({
            ...point, label: point.id === 'a' ? 'A1' : point.id === 'b' ? 'B₂' : point.id === 'c' ? 'C′' : point.label,
        })) };
        expect(parseFigureSpec(raw(spec), 'chord A1B₂ has length 4 cm.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'diameter A1B₂ has length 4 cm.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'Given A1C′ is the diameter.')).not.toBeNull();
    });

    it('冲突时保留完整旧图且整组回退，点名全部未知时保持保守', () => {
        const spec = circleSegmentTokenGeometry(basic);
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧圆线段图</text></svg>';
        expect(grade(spec, 'radius OA has length 3 cm.').figureSvg).not.toBeNull();
        expect(grade(spec, 'radius OB has length 3 cm.', legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(spec, 'radius OB has length 3 cm.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigureSpec(before, 'radius XY has length 3 cm.')).not.toBeNull();
        expect(parseFigureSpec(before, 'Given XY is a diameter.')).not.toBeNull();
        const group = { type: 'figure_group', figures: [{ label: '甲', figure: spec }, { label: '乙', figure: spec }] };
        const question = '图甲中：chord AB has length 4 cm；图乙中：diameter AB has length 4 cm。';
        expect(grade(group, question, legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(group, question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(raw(spec)).toBe(before);
    });

    it('后置关系在疑问、假设、引用和待证明语境中不当作已知条件', () => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        for (const question of [
            'Determine whether AB is a diameter.', 'If AB is a diameter, find the area.',
            'Prove AB is a diameter.', 'Is AB a diameter?',
            '判断AB是一条直径。', '证明AB为直径。', 'AB是一条直径吗？',
            '“AB是一条直径”这一说法正确吗？',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
    });
});

describe.each([false, true])('圆线段的后置圆归属（通用几何：%s）', (basic) => {
    it.each([
        ['AC是圆O的直径。', 'AB是圆O的直径。'],
        ['OA是圆O的一条半径。', 'OB是圆O的一条半径。'],
        ['AB为圆O的一条弦。', 'BC为圆O的一条弦。'],
    ])('中文后置圆归属仍须核对实际线段：%s', (valid, invalid) => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        expect(parseFigureSpec(spec, valid)).not.toBeNull();
        expect(parseFigureSpec(spec, invalid)).toBeNull();
    });

    it.each([
        ['AC是圆O的直径。', 'AC是圆A的直径。'],
        ['AC is a diameter of circle O.', 'AC is a diameter of circle A.'],
        ['OA is a radius of the circle O.', 'OA is a radius of the circle A.'],
        ['AB is a chord of circle O.', 'AB is a chord of circle A.'],
    ])('关系必须属于指定的圆而非任意一个圆：%s', (valid, invalid) => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        expect(parseFigureSpec(spec, valid)).not.toBeNull();
        expect(parseFigureSpec(spec, invalid)).toBeNull();
    });

    it('完整圆心点名保留数字、下标和撇号，缺失或大小写不同不能借用原圆心', () => {
        const base = circleSegmentTokenGeometry(basic);
        const spec = basic
            ? { ...base, points: base.points.map((point) => point.id === 'center' ? { ...point, label: 'O₁′' } : point) }
            : { ...base, center: { ...circleGeometry().center, label: 'O₁′' } };
        for (const question of ['AC是圆O₁′的直径。', 'AC is a diameter of circle O₁′.']) {
            expect(parseFigureSpec(raw(spec), question), question).not.toBeNull();
        }
        for (const name of ['O', 'O1′', 'o₁′', 'X']) {
            expect(parseFigureSpec(raw(spec), `AC是圆${name}的直径。`), name).toBeNull();
            expect(parseFigureSpec(raw(spec), `AC is a diameter of circle ${name}.`), name).toBeNull();
        }
    });

    it('后置归属不把疑问、否定、假设和待证明内容当成已知关系', () => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        for (const question of [
            '判断AB是圆O的直径。', '证明AB是圆O的直径。', 'AB是圆O的直径吗？',
            'AB不是圆O的直径。', '如果AB是圆O的直径，求面积。',
            'Determine whether AC is a diameter of circle A.',
            'If AC is a diameter of circle A, find the area.',
            'AC is not a diameter of circle A.',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
        expect(parseFigureSpec(spec, '已知AB是圆O的直径。')).toBeNull();
    });

    it('不截取过长点名或圆心名，部分缺点仍拒绝，全部未知保持保守', () => {
        const spec = raw(circleSegmentTokenGeometry(basic));
        for (const question of [
            'O B A是圆O的半径。', 'OBA是圆O的半径。',
            'AC is a diameter of circle O A.', 'XY是圆O的弦。',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
        expect(parseFigureSpec(spec, 'AX是圆O的弦。')).toBeNull();
        expect(parseFigureSpec(spec, 'AC is a diameter of circle O1.')).toBeNull();
    });

    it('明确冲突整组回退并保留完整旧SVG，输入数据保持不变', () => {
        const spec = circleSegmentTokenGeometry(basic);
        const group = { type: 'figure_group', figures: [{ label: '甲', figure: spec }, { label: '乙', figure: spec }] };
        const before = raw(group);
        const question = '图甲中：AC是圆O的直径；图乙中：AC是圆A的直径。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整后置圆归属图</text></svg>';
        expect(parseFigureSpec(before)).not.toBeNull();
        expect(grade(group, question, legacy)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(grade(group, question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(raw(group)).toBe(before);
    });
});

describe('复合圆图的后置完整圆名', () => {
    it.each([
        ['OD是内圆的半径。', 'OD是外圆的半径。'],
        ['AB是外圆的弦。', 'AB是内圆的弦。'],
        ['AC是外圆的一条直径。', 'AC是内圆的一条直径。'],
    ])('同心圆不能用另一半径对应的圆代替：%s', (valid, invalid) => {
        const spec = raw(concentricGeometry());
        expect(parseFigureSpec(spec, valid)).not.toBeNull();
        expect(parseFigureSpec(spec, invalid)).toBeNull();
    });

    it('英文完整圆名、特殊字符和隐藏圆心名称仍能唯一对应圆', () => {
        const base = concentricGeometry({ circles: [
            { center: 'center', radius: 20, label: '内圆(1)' },
            { center: 'center', radius: 40, label: 'outer circle' },
        ] });
        const spec = { ...base, points: [
            ...base.points.map((point) => point.id === 'center' ? { ...point, label: undefined } : point),
            { id: 'e', x: 30, y: 50, label: 'E' },
        ], segments: [...base.segments, { from: 'd', to: 'e' }] };
        expect(parseFigureSpec(raw(spec), 'DE是内圆(1)的弦。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'AB是内圆(1)的弦。')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'AB is a chord of the outer circle.')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'DE is a chord of the outer circle.')).toBeNull();
        expect(parseFigureSpec(raw(spec), 'OD是内圆(1)的半径。')).toBeNull();
    });

    it('明确局部归属优先于前面的范围，且不跨关系或跨句串用', () => {
        const spec = raw(concentricGeometry());
        expect(parseFigureSpec(spec, '内圆中，AB是外圆的弦。')).not.toBeNull();
        expect(parseFigureSpec(spec, '外圆中，AB是内圆的弦。')).toBeNull();
        expect(parseFigureSpec(spec, 'OD是内圆的半径，弦AB。')).not.toBeNull();
        expect(parseFigureSpec(spec, 'OD是内圆的半径；弦AB。')).not.toBeNull();
        expect(parseFigureSpec(spec, '内圆中，AB是外圆的弦，直径AC。')).toBeNull();
    });

    it('同名圆不能按端点或半径猜选，未标注的内外名称保持保守', () => {
        const duplicate = concentricGeometry({ circles: [
            { center: 'center', radius: 20, label: '目标圆' },
            { center: 'center', radius: 40, label: '目标圆' },
        ] });
        expect(parseFigureSpec(raw(duplicate), 'AB是目标圆的弦。')).toBeNull();
        expect(parseFigureSpec(raw(duplicate), 'AB is a chord of the 目标圆.')).toBeNull();
        const unnamed = concentricGeometry({ circles: [
            { center: 'center', radius: 20 }, { center: 'center', radius: 40 },
        ] });
        expect(parseFigureSpec(raw(unnamed), 'AB是内圆的弦。')).not.toBeNull();
    });

    it('完整圆名优先于圆心点名，不按部分圆名或半径猜测', () => {
        for (const [name, question] of [
            ['圆A', 'AC是圆A的直径。'],
            ['circle A', 'AC is a diameter of circle A.'],
            ['圆A1', 'AC是圆A1的直径。'],
        ]) {
            const spec = basicCircleGeometry({ circles: [{ center: 'center', radius: 30, label: name }] });
            expect(parseFigureSpec(raw(spec), question), question).not.toBeNull();
            expect(parseFigureSpec(raw(spec), 'AC是圆a的直径。')).toBeNull();
            expect(parseFigureSpec(raw(spec), 'AC是圆A12的直径。')).toBeNull();
        }
    });
});

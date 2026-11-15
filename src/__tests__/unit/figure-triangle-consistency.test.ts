import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec } from '@/lib/figure-spec';
import type { FigureSpec } from '@/lib/figure-spec';

type Geometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
type Coordinates = Array<[number, number]>;

const triangles = {
    scalene: [[20, 80], [80, 80], [40, 25]],
    isosceles: [[20, 80], [80, 80], [50, 20]],
    equilateral: [[20, 75], [80, 75], [50, 75 - 30 * Math.sqrt(3)]],
    right: [[20, 80], [80, 80], [20, 35]],
    rightIsosceles: [[20, 80], [80, 80], [20, 20]],
    skinnyRight: [[20, 80], [80, 80], [20, 75]],
} satisfies Record<string, Coordinates>;

function geometry(coordinates: Coordinates): Geometry {
    const points = coordinates.map(([x, y], index) => ({ id: String.fromCharCode(65 + index), x, y }));
    return { type: 'basic_geometry', points, polygons: [{ points: points.map((point) => point.id) }], segments: [], circles: [], angles: [], labels: [] };
}

const raw = (spec: unknown) => JSON.stringify(spec);
const area = (width: number, height: number, apexRatio = 0.5) => ({ type: 'area_geometry', shape: 'triangle', width, height, apexRatio });

function expectAccepted(spec: unknown, question: string) {
    expect(parseFigureSpecDetailed(raw(spec), question).diagnostic).toMatchObject({ ok: true, reason: 'ok' });
    const svg = renderFigureSpec(raw(spec));
    expect(svg).not.toBeNull();
    expect(renderFigureSpec(raw(spec), question)).toBe(svg);
}

function expectConflict(spec: unknown, question: string) {
    expect(parseFigureSpecDetailed(raw(spec), question)).toMatchObject({ spec: null, diagnostic: { ok: false, reason: 'semantic_validation' } });
}

describe('明确三角形子类型与结构化配图的一致性', () => {
    it.each([
        ['下图是一个等腰三角形。', 'scalene'],
        ['下图是一个等边三角形。', 'isosceles'],
        ['下图是一个直角三角形。', 'isosceles'],
        ['该图为等腰直角三角形。', 'right'],
        ['此图是直角等腰三角形。', 'skinnyRight'],
        ['The figure is an isosceles triangle.', 'scalene'],
        ['This diagram is an equilateral triangle.', 'rightIsosceles'],
        ['The shape is a right triangle.', 'isosceles'],
        ['The figure is a right-angled triangle.', 'isosceles'],
        ['The figure is an isosceles right triangle.', 'right'],
        ['The shape is a right isosceles triangle.', 'skinnyRight'],
    ] as const)('拒绝子类型矛盾：%s / %s', (question, actual) => {
        expectConflict(geometry(triangles[actual]), question);
    });

    it.each([
        ['等腰', 'isosceles', 'isosceles'], ['等腰', 'isosceles', 'equilateral'],
        ['等边', 'equilateral', 'equilateral'], ['直角', 'right', 'right'],
        ['等腰直角', 'isosceles right', 'rightIsosceles'],
        ['直角等腰', 'right-angled isosceles', 'rightIsosceles'],
    ] as const)('接受%s三角形的旋转与反向列点，保留原始 SVG', (chinese, english, actual) => {
        for (const radians of [0, Math.PI / 7, Math.PI / 2]) {
            const rotated = triangles[actual].map(([x, y]): [number, number] => [
                50 + (x - 50) * Math.cos(radians) - (y - 50) * Math.sin(radians),
                50 + (x - 50) * Math.sin(radians) + (y - 50) * Math.cos(radians),
            ]);
            for (const points of [rotated, [...rotated].reverse()]) {
                const spec = geometry(points);
                expectAccepted(spec, `下图是一个${chinese}三角形，面积是多少？`);
                expectAccepted(spec, `The figure is an ${english} triangle. What is its area?`);
            }
        }
    });

    it('等腰关系的完整边标注矛盾时拒绝，底边和高不参与两腰比较', () => {
        const spec = geometry(triangles.isosceles);
        spec.points.push({ id: 'D', x: 50, y: 80 });
        spec.segments = [
            { from: 'A', to: 'B', label: '10cm' }, { from: 'B', to: 'C', label: '1分米' },
            { from: 'C', to: 'A', label: '10厘米' }, { from: 'C', to: 'D', label: '6cm', dashed: true },
        ];
        expectAccepted(spec, '下图是一个等腰三角形。');
        spec.segments[2].label = '11厘米';
        expectConflict(spec, '下图是一个等腰三角形。');
    });

    it('等边完整边长精确比较，不因未知值或无单位值掩盖明确矛盾', () => {
        const spec = geometry(triangles.equilateral);
        spec.segments = [
            { from: 'A', to: 'B', label: '1分米' }, { from: 'B', to: 'C', label: '10cm' },
            { from: 'C', to: 'A', label: 'x' }, { from: 'A', to: 'C', label: '2' },
        ];
        expectAccepted(spec, '下图是一个等边三角形。');
        spec.segments.push({ from: 'C', to: 'A', label: '11cm' });
        expectConflict(spec, '下图是一个等边三角形。');
    });

    it('共线分段、辅助线和完整边名在子类型校验后仍保留', () => {
        const spec = geometry([[20, 80], [50, 80], [80, 80], [50, 20]]);
        spec.points.push({ id: 'O', x: 50, y: 55 });
        spec.segments = [
            { from: 'A', to: 'B', label: '3cm' }, { from: 'B', to: 'C', label: '3cm' },
            { from: 'C', to: 'D', label: '6cm' }, { from: 'D', to: 'A', label: '6cm' },
            { from: 'B', to: 'O', dashed: true },
        ];
        expectAccepted(spec, '下图是一个等腰三角形。');
    });

    it.each([
        ['4cm', '3cm', '5cm'], ['0.4分米', '30毫米', '0.05米'],
        ['1/2m', '3/8m', '5/8m'], ['4', '3.0', '5/1'],
    ])('直角三角形完整边长满足勾股关系：%s、%s、%s', (first, second, hypotenuse) => {
        const spec = geometry(triangles.right);
        spec.segments = [{ from: 'A', to: 'B', label: first }, { from: 'C', to: 'A', label: second }, { from: 'B', to: 'C', label: hypotenuse }];
        expectAccepted(spec, '下图是一个直角三角形。');
    });

    it.each(['6cm', '5.0000000000000001cm', '4cm'])('直角三角形不能接受矛盾斜边%s', (hypotenuse) => {
        const spec = geometry(triangles.right);
        spec.segments = [{ from: 'A', to: 'B', label: '4cm' }, { from: 'C', to: 'A', label: '3cm' }, { from: 'C', to: 'B', label: hypotenuse }];
        expectConflict(spec, '下图是一个直角三角形。');
    });

    it('未知、带根式、缺失单位或缺边时不猜测勾股数值，等腰直角的两条腿仍须相等', () => {
        for (const hypotenuse of ['5', '√25cm', 'x', undefined]) {
            const spec = geometry(triangles.right);
            spec.segments = [{ from: 'A', to: 'B', label: '4cm' }, { from: 'C', to: 'A', label: '3cm' }, { from: 'B', to: 'C', label: hypotenuse }];
            expectAccepted(spec, '下图是一个直角三角形。');
        }
        const unequalLegs = geometry(triangles.rightIsosceles);
        unequalLegs.segments = [{ from: 'A', to: 'B', label: '4cm' }, { from: 'C', to: 'A', label: '3cm' }];
        expectConflict(unequalLegs, '下图是一个等腰直角三角形。');
    });

    it.each([
        [area(6, 4, 0.3), '下图是一个等腰三角形。'],
        [area(6, 4), '下图是一个等边三角形。'],
        [area(6, 4), '下图是一个直角三角形。'],
        [area(6, 4, 0), '下图是一个等腰直角三角形。'],
    ])('面积模板同样不能只核对三条边：%s / %s', (spec, question) => {
        expectConflict(spec, question);
    });

    it.each([
        [area(6, 4), '下图是一个等腰三角形。'],
        [area(6, 3 * Math.sqrt(3)), '下图是一个等边三角形。'],
        [area(6, 3), '下图是一个等腰直角三角形。'],
        [area(6, Math.sqrt(6.75), 0.25), '下图是一个直角三角形。'],
        [area(6, 4, 0), '下图是一个直角三角形。'],
        [area(6, 4, 1), '下图是一个直角三角形。'],
        [area(6, 6, 0), '下图是一个等腰直角三角形。'],
        [area(6, 6, 1), 'The figure is a right-angled isosceles triangle.'],
    ])('面积模板接受符合子类型的真实形状：%s / %s', (spec, question) => {
        expectAccepted(spec, question);
    });

    it('仅当面积图的高本身是完整直角边时才按等腰条件比较底和高', () => {
        const apexRight = { ...area(6, 3), baseLabel: '10cm', heightLabel: '5cm', topLabel: '顶点' };
        expectAccepted(apexRight, '下图是一个等腰直角三角形。');
        const baseRight = { ...area(6, 6, 0), baseLabel: '1分米', heightLabel: '10厘米' };
        expectAccepted(baseRight, '下图是一个等腰直角三角形。');
        expectConflict({ ...baseRight, heightLabel: '11厘米' }, '下图是一个等腰直角三角形。');
    });

    it.each([0, 1])('端点直角的面积图不重复绘制虚线高：apexRatio=%s', (apexRatio) => {
        const svg = renderFigureSpec(raw({ ...area(6, 3, apexRatio), heightLabel: '高3cm' }));
        expect(svg).not.toBeNull();
        expect(svg).not.toContain('stroke-dasharray="7 5"');
        expect(svg).toContain('高3cm');
        expect((svg!.match(/stroke-width="1\.6"/g) ?? []).length).toBeGreaterThan(0);
    });

    it.each([
        '下图是一个等边三角形吗？', '证明下图是一个等边三角形。',
        '如果下图是一个等边三角形，求面积。', '下图是一个等边三角形。这个说法正确吗？',
        'The figure is an equilateral triangle. True or false?',
        'Assume the figure is an equilateral triangle.',
        'The figure is an equilateral triangle, if the two lengths agree.',
        '下图是一个三角形，另一个等边三角形的边长是6cm。',
        'The figure is a triangle. Another triangle is equilateral.',
    ])('不从疑问、命题或其它三角形补充子类型：%s', (question) => {
        expectAccepted(geometry(triangles.scalene), question);
    });

    it('子类型冲突保留完整旧 SVG，无旧图时不输出冲突结构', () => {
        const spec = raw(geometry(triangles.scalene));
        const question = '下图是一个等边三角形。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>已有配图</text></svg>';
        expect(parseFigure('true', legacy, spec, question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

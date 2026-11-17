import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (value: unknown) => JSON.stringify(value);
const coordinate = (x = 1, y = 2, label = 'A') => ({
    type: 'coordinate_plane', xMin: -4, xMax: 4, yMin: -4, yMax: 4,
    xStep: 2, yStep: 2,
    points: [{ id: 'internal-point', x, y, label }],
});
const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧坐标图</text></svg>';

describe('题干坐标与结构化坐标点的一致性', () => {
    it.each([
        '点A的坐标为(1,2)。', '已知点 A 的坐标是 (1, 2)，求 OA 的长度。',
        'A坐标为(1,2)。', '点A的坐标等于(1,2)。',
        'Point A has coordinates (1, 2).', 'A has the coordinates (1, 2).',
        'The coordinates of point A are (1, 2).', 'The coordinates of A are (1, 2).',
    ])('中英文明确坐标声明均拒绝横纵坐标冲突：%s', (question) => {
        expect(parseFigureSpec(raw(coordinate()), question)).not.toBeNull();
        expect(parseFigureSpec(raw(coordinate(2, 1)), question)).toBeNull();
        expect(parseFigureSpec(raw(coordinate(-1, 2)), question)).toBeNull();
    });

    it('图上实际点位与题干一致时保留输出，不移动点或替换题干数字', () => {
        const spec = coordinate();
        const source = raw(spec);
        const question = '如图，点A的坐标为(1,2)。';
        const result = renderFigureSpecDetailed(source, question);
        expect(result.svg).not.toBeNull();
        const document = new DOMParser().parseFromString(result.svg!, 'image/svg+xml');
        const pointLabel = document.querySelector('text[data-figure-label="point"]');
        expect(pointLabel?.textContent).toBe('A');
        expect(Number(pointLabel?.getAttribute('data-point-x'))).toBeCloseTo(448.75, 8);
        expect(Number(pointLabel?.getAttribute('data-point-y'))).toBeCloseTo(152.5, 8);
        expect(raw(spec)).toBe(source);
        expect(parseFigureSpec(source, '点A的坐标为(3,2)。')).toBeNull();
        expect(raw(spec)).toBe(source);
    });

    it.each([
        [0.3, -2.5, '(+0.3000, − 2.500)'], [0, -0, '(-0.00,+0)'],
        [1e-7, 2, '(.0000001,2)'],
    ] as const)('有限十进制坐标保持精确比较：%s / %s', (x, y, tuple) => {
        expect(parseFigureSpec(raw(coordinate(x, y)), `点A的坐标为${tuple}。`)).not.toBeNull();
    });

    it('不以浮点近似把不同的小数当作相同坐标', () => {
        expect(parseFigureSpec(raw(coordinate(0.3, 2)), '点A的坐标为(0.30000000000000001,2)。')).toBeNull();
        expect(parseFigureSpec(raw(coordinate(1, 2)), '点A的坐标为(1,2.0000000000000001)。')).toBeNull();
        expect(parseFigureSpec(raw(coordinate(1e-7, 2)), '点A的坐标为(.0000002,2)。')).toBeNull();
    });

    it.each(['A1', 'A₁', 'A′', "A'", 'a'])('可见点名 %s 支持数字、下标、撇号与小写', (label) => {
        const spec = raw(coordinate(1, 2, label));
        expect(parseFigureSpec(spec, `点${label}的坐标为(1,2)。`)).not.toBeNull();
        expect(parseFigureSpec(spec, `点${label}的坐标为(2,1)。`)).toBeNull();
    });

    it('全角标点、数字与点名及常见公式外框不影响完整声明', () => {
        const source = raw(coordinate());
        for (const [valid, conflict] of [
            ['点Ａ的坐标为（１，２）。', '点Ａ的坐标为（２，１）。'],
            ['点A的坐标为$(1,2)$。', '点A的坐标为$(2,1)$。'],
            ['点A的坐标为$$(1,2)$$。', '点A的坐标为$$(2,1)$$。'],
            ['点A的坐标为\\((1,2)\\)。', '点A的坐标为\\((2,1)\\)。'],
            ['点A的坐标为\\[(1,2)\\]。', '点A的坐标为\\[(2,1)\\]。'],
        ]) {
            expect(parseFigureSpec(source, valid), valid).not.toBeNull();
            expect(parseFigureSpec(source, conflict), conflict).toBeNull();
        }
    });

    it('只核对可见同名点，不把隐藏 ID、大小写或说明文字当成点名', () => {
        const spec = { ...coordinate(1, 2, 'B'), points: [{ id: 'A', x: 1, y: 2, label: 'B' }] };
        expect(parseFigureSpec(raw(spec), '点A的坐标为(3,4)。')).not.toBeNull();
        expect(parseFigureSpec(raw(coordinate()), '点a的坐标为(3,4)。')).not.toBeNull();
        expect(parseFigureSpec(raw(coordinate(1, 2, '点A')), '点A的坐标为(3,4)。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '点B的坐标为(3,4)。')).toBeNull();
    });

    it.each([
        '如果点A的坐标为(3,4)，求长度。', '证明点A的坐标为(3,4)。',
        '判断点A的坐标为(3,4)。', '点A的坐标为(3,4)吗？',
        '求证点A的坐标为(3,4)。',
        '点A的坐标为(3,4)，这个说法正确吗？', '点A的坐标为(3,4)。请判断这个说法。',
        '点A的坐标为(3,4)，若横坐标是3。', '“点A的坐标为(3,4)”。',
        "'点A的坐标为(3,4)'。", 'Is it true that point A has coordinates (3, 4)?',
        'If point A has coordinates (3, 4), find the distance.',
        'The coordinates of A are (3, 4), right?',
        'The coordinates of A are (3, 4). Determine whether this statement is true.',
        'Verify that point A has coordinates (3, 4).',
        '下列说法正确的是：点A的坐标为(3,4)。',
        '点A的坐标为(3,4)，这个说法是错误的。',
    ])('不把疑问、假设、引用及候选说法当作已知点位：%s', (question) => {
        expect(parseFigureSpec(raw(coordinate()), question)).not.toBeNull();
    });

    it.each([
        '点A的坐标为(1,2)，平移后点A的坐标为(3,4)。',
        '旋转后点A的坐标为(3,4)。', '在另一个坐标系中，点A的坐标为(3,4)。',
        'After translation, point A has coordinates (3, 4).',
        'The coordinates of A are (3, 4) in another coordinate system.',
        '在新坐标系中，点A的坐标为(3,4)。',
        '点B相对于点A的坐标为(3,4)。',
        '向量A的坐标为(3,4)。',
        'Vector A has coordinates (3, 4).',
        'The polar coordinates of A are (3, 4).',
    ])('多阶段变换和其它坐标系不强行套用同一个图点：%s', (question) => {
        expect(parseFigureSpec(raw(coordinate()), question)).not.toBeNull();
    });

    it.each([
        '点A的坐标为(1+2,4)。', '点A的坐标为(1/2,4)。', '点A的坐标为(3,4,5)。',
        'A(3,4)，求点B的坐标。',
        '点A的坐标为(3,4)或(1,2)。', '点A的坐标为$(3,4)。',
        '点A的坐标为(3,4]。', '点A的坐标为(3e0,4)。',
    ])('不从不完整或复合表达式中截取坐标：%s', (question) => {
        expect(parseFigureSpec(raw(coordinate()), question)).not.toBeNull();
    });

    it('多个静态点和同一坐标的多处声明必须各自相符', () => {
        const spec = { ...coordinate(), points: [
            { id: 'a', x: 1, y: 2, label: 'A' }, { id: 'b', x: -2, y: 1, label: 'B' },
        ] };
        expect(parseFigureSpec(raw(spec), '点A的坐标为(1,2)，点B的坐标为(-2,1)。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '点A的坐标为(1,2)，点B的坐标为(-3,1)。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '点A的坐标为(1,2)。点A的坐标为(2,1)。')).toBeNull();
    });

    it('图组仅在明确分段后逐张校验，矛盾时使用完整旧图回退', () => {
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: coordinate() }, { label: '乙', figure: coordinate(2, 1) },
        ] };
        const question = '图甲中：点A的坐标为(1,2)；图乙中：点A的坐标为(2,1)。';
        expect(parseFigureSpec(raw(group), question)).not.toBeNull();
        const mismatch = question.replace('(2,1)', '(3,1)');
        expect(parseFigureSpec(raw(group), mismatch)).toBeNull();
        expect(parseFigure('true', legacy, raw(group), mismatch)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(group), mismatch)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigureSpec(raw(group), '点A的坐标为(3,4)。')).not.toBeNull();
    });

    it('明确分段子图中缺失点名不能用其它子图的点代替', () => {
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: coordinate(1, 2, 'B') }, { label: '乙', figure: coordinate() },
        ] };
        expect(parseFigureSpec(raw(group), '图甲中：点A的坐标为(1,2)；图乙中：点A的坐标为(1,2)。')).toBeNull();
    });

    it('普通几何的相对布局坐标不冒充数学坐标', () => {
        const spec = { type: 'basic_geometry', points: [{ id: 'a', x: 50, y: 50, label: 'A' }] };
        expect(parseFigureSpec(raw(spec), '点A的坐标为(3,4)。')).not.toBeNull();
    });

    it('单图冲突报告语义失败并保留完整旧图，不补点或覆盖现有图', () => {
        const source = raw(coordinate());
        const question = '点A的坐标为(2,1)。';
        expect(renderFigureSpecDetailed(source, question)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation', type: 'coordinate_plane' },
        });
        expect(parseFigure('true', legacy, source, question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, source, question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

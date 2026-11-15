import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const circle = {
    type: 'circle_geometry', center: { id: 'O', x: 50, y: 50 }, radius: 30,
    points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 20, y: 50 }, { id: 'C', x: 50, y: 80 }],
};
const raw = (value: unknown) => JSON.stringify(value);
const chord = (label: string, from = 'A', to = 'C') => ({ from, to, label });
const radius = (label: string) => ({ to: 'B', label });

describe('圆图弦长的明确数学关系', () => {
    it.each([
        { name: '弦长超过半径两倍', spec: { ...circle, radii: [radius('3cm')], chords: [chord('7cm')] } },
        { name: '只标直径时弦长仍不能超过直径', spec: { ...circle, diameters: [chord('6cm', 'A', 'B')], chords: [chord('7cm')] } },
        { name: '单位换算后弦长仍超过直径', spec: { ...circle, radii: [radius('半径1/2m')], chords: [chord('101厘米')] } },
        { name: '不能用浮点容差放行超长弦', spec: { ...circle, radii: [radius('0.3cm')], chords: [chord('0.6000000000000001cm')] } },
        { name: '弦长前缀也必须核对', spec: { ...circle, radii: [radius('半径3cm')], chords: [chord('弦长为7厘米')] } },
        { name: '同一条弦反向标注不能有两个长度', spec: { ...circle, chords: [chord('4cm'), chord('5cm', 'C', 'A')] } },
        { name: '同一线段兼作弦和直径时长度必须相等', spec: { ...circle, diameters: [chord('6cm', 'A', 'B')], chords: [chord('5cm', 'B', 'A')] } },
        { name: '未知直径不能遮住已知半径给出的上限', spec: { ...circle, radii: [radius('3cm')], diameters: [chord('x', 'A', 'B')], chords: [chord('7cm')] } },
        { name: '未知半径不能遮住已知直径给出的上限', spec: { ...circle, radii: [radius('x')], diameters: [chord('6cm', 'A', 'B')], chords: [chord('7cm')] } },
        { name: '弦长前缀后为零仍非法', spec: { ...circle, chords: [chord('弦长为0厘米')] } },
        { name: '弦长前缀后分母为零仍非法', spec: { ...circle, chords: [chord('弦长为1/0cm')] } },
    ])('$name 时语义校验拒绝', ({ spec }) => {
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each([
        { ...circle, radii: [radius('3cm')], chords: [chord('4cm')] },
        { ...circle, radii: [radius('1/2m')], chords: [chord('100厘米', 'A', 'B')] },
        { ...circle, radii: [radius('3')], chords: [chord('6', 'A', 'B')] },
        { ...circle, chords: [chord('1分米'), chord('10cm', 'C', 'A')] },
        { ...circle, diameters: [chord('1米', 'A', 'B')], chords: [chord('100cm', 'B', 'A')] },
        { ...circle, radii: [radius('1m')], chords: [chord('弦长为1又1/2m')] },
        { ...circle, diameters: [chord('1m', 'A', 'B')], chords: [chord('弦长是0.3m')] },
    ])('正确的上限或等价标注不改变原文：%s', (spec) => {
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('不同的弦各自校验，不要求所有弦等长', () => {
        const spec = { ...circle, radii: [radius('3cm')], chords: [chord('4cm'), chord('5cm', 'B', 'C')] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('不把相对半径或图上的角度当作物理长度比例', () => {
        const spec = { ...circle, radii: [radius('100cm')], chords: [chord('60cm')] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('没有已知物理半径或直径时，不拿相对尺寸补出弦长上限', () => {
        const spec = { ...circle, chords: [chord('1000cm')] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('只校验结构数值不会改动正常圆图的 SVG 绘制', () => {
        const base = { ...circle, radii: [radius('3cm')], chords: [chord('4cm')] };
        const equivalent = { ...base, chords: [chord('40mm')] };
        const first = renderFigureSpecDetailed(raw(base));
        const second = renderFigureSpecDetailed(raw(equivalent));
        expect(first.diagnostic.reason).toBe('ok');
        expect(second.diagnostic.reason).toBe('ok');
        expect(first.svg).toContain('>4cm</text>');
        expect(second.svg).toContain('>40mm</text>');
        expect(first.svg).toMatch(/<circle cx="400" cy="250" r="117"/);
        expect(second.svg).toMatch(/<circle cx="400" cy="250" r="117"/);
    });

    it.each(['x', '√2cm', '1/□cm', '约7cm', '7in'])('未知表达式 %s 不求值或补单位', (label) => {
        const spec = { ...circle, radii: [radius('3cm')], chords: [chord(label)] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('缺失单位不继承其它标注的单位，但已知同单位矛盾不能被忽略', () => {
        const unitlessRadius = { ...circle, radii: [radius('3')], chords: [chord('7cm')] };
        expect(parseFigureSpec(raw(unitlessRadius))).toMatchObject(unitlessRadius);
        const metricDiameter = { ...unitlessRadius, diameters: [chord('6cm', 'A', 'B')] };
        expect(parseFigureSpec(raw(metricDiameter))).toBeNull();
    });

    it('图组分别校验每个圆，单个矛盾不能被省略或覆盖旧图', () => {
        const good = { ...circle, radii: [radius('3cm')], chords: [chord('4cm')] };
        const other = { ...circle, radii: [radius('4cm')], chords: [chord('5cm')] };
        const bad = { ...circle, radii: [radius('3cm')], chords: [chord('7cm')] };
        const group = { type: 'figure_group', figures: [{ label: 'A', figure: good }, { label: 'B', figure: other }] };
        expect(renderFigureSpecDetailed(raw(group)).svg).not.toBeNull();
        const badGroup = { ...group, figures: [{ label: 'A', figure: good }, { label: 'B', figure: bad }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧配图</text></svg>';
        for (const spec of [bad, badGroup]) {
            expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });
});

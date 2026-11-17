import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';
import { validateFigureRightTriangleLengths, validateFigureTriangleLengths } from '@/lib/figure-measurements';

const square = { type: 'area_geometry', shape: 'square', width: 40, height: 40 };
const cube = { type: 'solid_geometry', shape: 'cube', width: 40, depth: 40, height: 40 };
const circle = {
    type: 'circle_geometry', center: { id: 'O', x: 50, y: 50 }, radius: 30,
    points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 20, y: 50 }, { id: 'C', x: 50, y: 80 }],
};
const rightAngle = {
    type: 'basic_geometry',
    points: [{ id: 'O', x: 30, y: 60 }, { id: 'A', x: 75, y: 60 }, { id: 'B', x: 30, y: 20 }],
    segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
};
const raw = (value: unknown) => JSON.stringify(value);

describe('结构化配图中的明确度量关系', () => {
    it('三边关系先按倍数换算，直径的一半不能冒充完整直径参与勾股比较', () => {
        const radius = [{ label: '6cm', multiple: 2 as const }];
        expect(validateFigureRightTriangleLengths(radius, [{ label: '4cm' }], [{ label: '5cm' }])).toBe(true);
        expect(validateFigureRightTriangleLengths(radius, [{ label: '4cm' }], [{ label: '6cm' }])).toBe(false);
        expect(validateFigureTriangleLengths([radius, [{ label: '1cm' }], [{ label: '5cm' }]])).toBe(false);
        expect(validateFigureTriangleLengths([radius, [{ label: '4cm' }], [{ label: '5cm' }]])).toBe(true);
    });
    it.each([
        { name: '正方形底和高不同', spec: { ...square, baseLabel: '边长5cm', heightLabel: '6cm' } },
        { name: '正方形第三条边不同', spec: { ...square, baseLabel: '5cm', topLabel: '6cm' } },
        { name: '矩形上下边不同', spec: { ...square, shape: 'rectangle', baseLabel: '长6厘米', topLabel: '长7厘米' } },
        { name: '平行四边形上下底不同', spec: { ...square, shape: 'parallelogram', baseLabel: '底6厘米', topLabel: '上底7厘米' } },
        { name: '正方体棱长不同', spec: { ...cube, widthLabel: '棱长4', heightLabel: '5' } },
        { name: '换算单位后仍不同', spec: { ...square, baseLabel: '1分米', heightLabel: '11厘米' } },
        { name: '有限小数不能近似视为相等', spec: { ...square, baseLabel: '0.3cm', heightLabel: '0.3000000000000001cm' } },
        { name: '同圆两个半径不同', spec: { ...circle, radii: [{ to: 'A', label: '3cm' }, { to: 'C', label: '4cm' }] } },
        { name: '直径不是半径两倍', spec: { ...circle, radii: [{ to: 'A', label: '半径3cm' }], diameters: [{ from: 'A', to: 'B', label: '直径5cm' }] } },
        { name: '同圆直径不同', spec: { ...circle, diameters: [{ from: 'A', to: 'B', label: '6cm' }, { from: 'B', to: 'A', label: '7cm' }] } },
        { name: '直角标成60度', spec: { ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right', label: '60°' }] } },
        { name: '直角标成负90度', spec: { ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right', label: '-90度' }] } },
    ])('$name 时整图回退', ({ spec }) => {
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation', type: spec.type } });
    });

    it.each([
        ['边长为1分米', '10厘米', '100mm'],
        ['0.1m', '10cm', '100毫米'],
        ['1/2m', '50cm', '0.5米'],
        ['1 1/2cm', '15mm', '1.5厘米'],
        ['1又1/2cm', '15mm', '1.5厘米'],
        ['0.3cm', '3mm', '0.30厘米'],
        ['1公里', '1000米', '1km'],
        ['5', '5.0', '5/1'],
    ])('只在校验时换算 %s，保存的标注不改写', (baseLabel, heightLabel, topLabel) => {
        const spec = parseFigureSpec(raw({ ...square, baseLabel, heightLabel, topLabel }));
        expect(spec).toMatchObject({ baseLabel, heightLabel, topLabel });
    });

    it('全角数字和单位沿用原有规范化，再验证长度关系', () => {
        expect(parseFigureSpec(raw({ ...square, baseLabel: '边长５ｃｍ', heightLabel: '５０ｍｍ', topLabel: '５厘米' }))).toMatchObject({ baseLabel: '边长5cm', heightLabel: '50mm', topLabel: '5厘米' });
    });

    it.each(['0cm', '-1cm', '−1cm', '1/0cm', '0/2cm'])('明确非法长度 %s 不作为未知表达式放行', (baseLabel) => {
        expect(renderFigureSpecDetailed(raw({ ...square, shape: 'triangle', baseLabel }))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it('正方体换算单位后棱长一致即可，不拿相对绘图尺寸和物理长度比较', () => {
        const spec = { ...cube, widthLabel: '棱长1m', depthLabel: '100cm', heightLabel: '10dm' };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('矩形和长方体的不同方向可以不同长度，三角形顶点说明不当成底边长度', () => {
        for (const spec of [
            { ...square, shape: 'rectangle', baseLabel: '6cm', heightLabel: '4cm', topLabel: '6cm' },
            { ...cube, shape: 'cuboid', widthLabel: '6cm', depthLabel: '4cm', heightLabel: '5cm' },
            { ...square, shape: 'triangle', baseLabel: '6cm', heightLabel: '4cm', topLabel: '3cm' },
            { ...square, shape: 'trapezoid', topWidth: 20, baseLabel: '6cm', topLabel: '4cm', heightLabel: '5cm' },
        ]) expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it('半径和直径允许不同单位和分数，不改变原文字或相对半径', () => {
        const spec = { ...circle, radii: [{ to: 'A', label: '半径1/2m' }], diameters: [{ from: 'A', to: 'B', label: '直径100厘米' }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it.each(['90°', '90度', '90.0 °', '180/2度', '90 degrees', '90 degree'])('直角的明确标注 %s 可以保留', (label) => {
        const spec = { ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right', label }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject(spec);
    });

    it.each(['60 degrees', '90.00000000000000001 degrees', '1/0 degrees'])('直角的英文度数标注 %s 不能绕过精确校验', (label) => {
        expect(parseFigureSpec(raw({ ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right', label }] }))).toBeNull();
    });

    it.each(['1', 'α', 'x°', '(x+30)°', '?', '□'])('直角编号或未知表达式 %s 不被求值或当作度数', (label) => {
        expect(parseFigureSpec(raw({ ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right', label }] }))).toMatchObject({ angles: [{ label }] });
    });

    it('普通角的数值标注不按相对绘图角度强比较', () => {
        expect(parseFigureSpec(raw({ ...rightAngle, angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'arc', label: '60°' }] }))).not.toBeNull();
    });

    it.each(['a', '2a', '√2cm', 'x+1cm', '1/□cm', '____', '5cm²', '面积5cm', '约5cm', '5in'])('不强行解析未知格式 %s', (heightLabel) => {
        expect(parseFigureSpec(raw({ ...square, baseLabel: '1cm', heightLabel }))).toMatchObject({ heightLabel });
    });

    it('无单位长度不继承其它字段单位，单位明确的矛盾仍须拒绝', () => {
        expect(parseFigureSpec(raw({ ...square, baseLabel: '1', heightLabel: '10cm' }))).not.toBeNull();
        expect(parseFigureSpec(raw({ ...square, baseLabel: '1', heightLabel: '10cm', topLabel: '11cm' }))).toBeNull();
    });

    it('同组不同子图的边长独立，不要求所有选项数值相同', () => {
        const group = { type: 'figure_group', figures: [
            { label: 'A', figure: { ...square, baseLabel: '5cm', heightLabel: '5cm' } },
            { label: 'B', figure: { ...square, baseLabel: '6cm', heightLabel: '6cm' } },
        ] };
        expect(renderFigureSpecDetailed(raw(group)).svg).not.toBeNull();
    });

    it('矛盾子图不能单独省略，单图和整组均保留完整旧 SVG 或无图回退', () => {
        const bad = { ...square, baseLabel: '5cm', heightLabel: '6cm' };
        const group = { type: 'figure_group', figures: [{ label: 'A', figure: square }, { label: 'B', figure: bad }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>已有完整配图</text></svg>';
        for (const spec of [bad, group]) {
            expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
            expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });
});

import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';

const raw = (value: unknown) => JSON.stringify(value);
const arithmetic = (top: string, bottom: string, operation: '×' | '+' | '-' | '÷' = '×') => ({
    type: 'vertical_arithmetic', operation, top, bottom,
    partialProducts: operation === '×' ? [{ value: '□□□', shift: 0 }] : [],
});
const area = (shape: 'triangle' | 'rectangle' | 'square' | 'parallelogram' | 'trapezoid') => ({
    type: 'area_geometry', shape, width: 6, height: shape === 'square' ? 6 : 4,
    ...(shape === 'trapezoid' ? { topWidth: 3 } : {}),
});
const solid = (shape: 'cube' | 'cuboid') => ({
    type: 'solid_geometry', shape, width: 4, depth: 4, height: 4,
});

describe('题干与结构化配图的一致性', () => {
    it('两位数乘25只约束明确的乘数和位数', () => {
        const question = '观察两位数乘25的乘法竖式，与个位5相乘的积记为甲。';
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '24')), question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(arithmetic('123', '25')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('题干明确写出算式时核对上下顺序和运算符', () => {
        const question = '请列竖式计算 34 × 25。';
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('43', '25')), question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(arithmetic('34', '24')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('中文算式、混合单位空格和算式前题号均可核对', () => {
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '20. 竖式计算34乘25。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '竖式计算34乘24。').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '竖式计算34 × 25 = 850。').figureSvg).not.toBeNull();
    });

    it('全角数字、中文乘法和英文位数表达也能用于明确校验', () => {
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '计算３４×２５的竖式。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), 'a two-digit number times 25').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '24')), '两位数与25相乘').figureSvg).toBeNull();
    });

    it('部分积和结果仍由原有结构规则处理，题干不明确时不因故事数字误拦截', () => {
        const story = '小明有34本书，给同学25本后还剩一些，图中用字母表示未知数。';
        expect(parseFigure('true', null, raw(arithmetic('x', 'y')), story).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '观察竖式，其中个位数字记为甲。').figureSvg).not.toBeNull();
    });

    it('题干只给位数和未知乘数时不要求猜测具体数值', () => {
        const question = '观察三位数乘一个两位数的竖式。';
        expect(parseFigure('true', null, raw(arithmetic('□□□', '□□')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '□□')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('题干列出多个候选算式时不擅自选择其中之一', () => {
        const question = '比较34×25与43×25，哪一个积更大？';
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('43', '25')), question).figureSvg).not.toBeNull();
    });

    it('题干列出多个不同位数条件时不把它们同时套到一张图', () => {
        const question = '比较两位数乘25和三位数乘25的积。';
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□□', '25')), question).figureSvg).not.toBeNull();
    });

    it('旧 SVG 是完整回退，不因结构化条件矛盾而被覆盖', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有竖式</text></svg>';
        const question = '请列竖式计算34×25。';
        expect(parseFigure('true', legacy, raw(arithmetic('43', '25')), question)).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it.each([
        ['正方形题干却返回长方形结构', area('rectangle'), '下图是一个正方形，边长为5厘米。'],
        ['长方形题干却返回三角形结构', area('triangle'), '下图是一个长方形，长为6厘米，宽为4厘米。'],
        ['正方体主图却使用不等长棱', { ...solid('cuboid'), depth: 3, height: 2 }, '下图是一个正方体，棱长是4厘米。'],
        ['三角形主图却返回长方形结构', area('rectangle'), '该图为直角三角形，求面积。'],
        ['英文主图声明却返回错误形状', area('triangle'), 'This diagram is a rectangle. Find its area.'],
        ['英文正方体主图却使用不等长棱', { ...solid('cuboid'), depth: 3, height: 2 }, 'The solid is a cube with an edge of 4 cm.'],
    ])('%s 时拒绝冲突结构', (_name, spec, question) => {
        expect(parseFigure('true', null, raw(spec), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('唯一形状与题干一致时保留，题干同时讨论多种形状时不猜测', () => {
        expect(parseFigure('true', null, raw(area('square')), '下图是正方形，求它的面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('trapezoid')), '下图是等腰梯形，求面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cuboid')), '长方体的长宽高分别是4、3、2厘米。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '比较正方形与长方形的面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), '求正方形内部三角形的面积。').figureSvg).not.toBeNull();
    });

    it('图组中的各子图不使用整道题的单一形状词逐一误判', () => {
        const group = {
            type: 'figure_group',
            figures: [
                { label: '甲', figure: area('square') },
                { label: '乙', figure: area('triangle') },
            ],
        };
        expect(parseFigure('true', null, raw(group), '比较正方形和三角形的面积。').figureSvg).not.toBeNull();
    });

    it('形状冲突时优先保留完整旧 SVG', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有图形</text></svg>';
        expect(parseFigure('true', legacy, raw(area('rectangle')), '下图是一个正方形。')).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('英文形状词可核对，嵌套图形或否定句保持保守', () => {
        expect(parseFigure('true', null, raw(area('square')), 'Find the area of a square.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'The figure is a rectangle. Find its area.').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(solid('cube')), 'A cube has edge length 4 cm.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'Find the area of a triangle inside a square.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'It is not a square; it is a rectangle.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'The area is 12 square centimeters.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'Find the square root of 16.').figureSvg).not.toBeNull();
    });

    it.each([
        [area('square'), '一个正方体的底面如下图，求底面积。'],
        [area('rectangle'), '这不是一个正方形，请观察形状。'],
        [area('rectangle'), '下图是一个正方形吗？'],
        [area('triangle'), '下图是一个正方形，求阴影部分的面积。'],
        [area('rectangle'), 'The area is 12 square kilometers.'],
        [area('rectangle'), 'The figure is not a square.'],
        [area('triangle'), 'The figure is a square. Find the shaded area.'],
    ])('局部图、形状判断和非形状单词不限制主图模板：%s / %s', (spec, question) => {
        expect(parseFigure('true', null, raw(spec), question).figureSvg).not.toBeNull();
    });

    it('兼容模板画出的正方形和正方体不因类型名称不同而回退', () => {
        const squareRectangle = { ...area('rectangle'), width: 6, height: 6 };
        expect(parseFigure('true', null, raw(squareRectangle), '下图是一个正方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('square')), '下图是一个长方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '下图是一个平行四边形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('parallelogram')), '下图是一个长方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cuboid')), '下图是一个正方体。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cube')), '下图是一个长方体。').figureSvg).not.toBeNull();
    });

    it('兼容模板仍需满足明确主图的长度标注，不改写单位或补充未知值', () => {
        const squareRectangle = { ...area('rectangle'), width: 6, height: 6 };
        const unequalLabels = { ...squareRectangle, baseLabel: '5cm', heightLabel: '6cm' };
        const unequalEdges = { ...solid('cuboid'), widthLabel: '5cm', heightLabel: '6cm' };
        expect(parseFigure('true', null, raw(unequalLabels), '下图是一个正方形。').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(unequalEdges), '下图是一个正方体。').figureSvg).toBeNull();
        const metricLabels = { ...squareRectangle, baseLabel: '1分米', heightLabel: '10cm' };
        const svg = parseFigure('true', null, raw(metricLabels), '下图是一个正方形。').figureSvg;
        expect(svg).toContain('1分米');
        expect(svg).toContain('10cm');
    });

    it('没有主图声明时不把故事对象当成配图约束', () => {
        expect(parseFigure('true', null, raw(area('triangle')), '工人用正方形纸张制作了一面旗帜。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'Find the area in square units.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'A square sheet is used to make a flag.').figureSvg).not.toBeNull();
    });
});

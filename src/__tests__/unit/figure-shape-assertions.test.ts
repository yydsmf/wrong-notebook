import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpecDetailed } from '@/lib/figure-spec';

const triangle = { type: 'area_geometry', shape: 'triangle', width: 6, height: 4 };
const rectangle = { type: 'area_geometry', shape: 'rectangle', width: 6, height: 4 };
const cuboid = { type: 'solid_geometry', shape: 'cuboid', width: 6, depth: 4, height: 3 };
const raw = (value: unknown) => JSON.stringify(value);

describe('明确主图声明与后续提问的作用范围', () => {
    it.each([
        ['下图是一个正方形，面积是多少？', triangle],
        ['下图是一个正方形。它的面积是多少？', triangle],
        ['20. 下图是一个正方形，边长为3.5厘米，面积是多少？', triangle],
        ['（1）下图是一个长方形，长6厘米、宽4厘米，周长是多少？', triangle],
        ['该图为直角三角形，底6厘米、高4厘米，面积是多少？', rectangle],
        ['下图是一个正方体，体积是多少？', cuboid],
        ['The figure is a square. What is its area?', triangle],
        ['Given that the figure is a square, what is its area?', triangle],
        ['The diagram is a rectangle with a side of 3.5 cm. What is its area?', triangle],
        ['The solid is a cube; what is its volume?', cuboid],
        ['下图是一个正方形，判断它的面积是否为36平方厘米？', triangle],
        ['The figure is a square, can its area be 25 cm²?', triangle],
        ['下图是一个正方形。若边长为5厘米，面积是多少？', triangle],
        ['The figure is a square. If its side is 5 cm, what is its area?', triangle],
        ['The figure is a square; determine whether its area is 25 cm².', triangle],
        ['下图是一个正方形。是否能算出它的面积？', triangle],
        ['The figure is a square. Is it possible to find its area?', triangle],
        ['The figure is a square, right angles are marked. What is its area?', triangle],
    ])('后续求值提问不应取消声明：%s', (question, spec) => {
        expect(parseFigureSpecDetailed(raw(spec), question)).toMatchObject({
            spec: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it.each([
        '下图是一个正方形吗？',
        '下图是一个正方形？',
        '下图是一个正方形吗，为什么？',
        '判断下图是一个正方形是否正确。',
        '请证明下图是一个正方形。',
        '若下图是一个正方形，求边长。',
        '如果下图是一个正方形，面积会是多少？',
        '当下图是一个正方形时，求面积。',
        '下图是一个正方形，这一说法对吗？',
        '下图是一个正方形，对不对？',
        'The figure is a square, right?',
        "The figure is a square, isn't it?",
        'Is it true that the figure is a square?',
        'Prove that the figure is a square.',
        'If the figure is a square, find its area.',
        'The figure is a square if all sides are equal.',
        'The figure is a square, provided that all sides are equal.',
        '"The figure is a square", is this statement correct?',
        '小明认为，下图是一个正方形，请判断他的说法。',
        'The figure is not a square. The figure is a square.',
        '下图是一个正方形，请判断这一说法是否正确。',
        '下图是一个正方形，请判断对错。',
        '下图是一个正方形，判断正误。',
        '下图是一个正方形。判断这句话是否正确。',
        '下图是一个正方形。这一说法正确吗？',
        '下图是一个正方形的话，求边长。',
        'The figure is a square, determine whether this statement is correct.',
        'The figure is a square. True or false?',
        'True or false: the figure is a square.',
        'The figure is a square; prove this statement.',
        'The figure is a square when all sides are equal.',
        'Suppose that the figure is a square. Find its area.',
    ])('形状疑问、条件和引用不当作既定事实：%s', (question) => {
        expect(parseFigureSpecDetailed(raw(rectangle), question).spec).toMatchObject(rectangle);
    });

    it.each([
        '下图是一个正方形，求阴影部分的面积？',
        '下图是一个正方体，求截面的面积？',
        'The figure is a square. What is the shaded area?',
        '下图是一个正方形，另一个图是三角形。面积是多少？',
    ])('局部图或多个形状继续保守跳过：%s', (question) => {
        expect(parseFigureSpecDetailed(raw(triangle), question).spec).toMatchObject(triangle);
    });

    it.each([
        '下图是一个正方形，边长为1分米，面积是多少？',
        'The figure is a square. What is its area?',
    ])('正确兼容模板和等价长度标注仍保留原文：%s', (question) => {
        const spec = { ...rectangle, width: 6, height: 6, baseLabel: '1分米', heightLabel: '10cm' };
        expect(parseFigureSpecDetailed(raw(spec), question).spec).toMatchObject(spec);
        const result = renderFigureSpecDetailed(raw(spec), question);
        expect(result.diagnostic.reason).toBe('ok');
        expect(result.svg).toContain('1分米');
        expect(result.svg).toContain('10cm');
    });

    it('图组不把主图声明直接套到每一张子图', () => {
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: triangle }, { label: '乙', figure: rectangle },
        ] };
        expect(parseFigureSpecDetailed(raw(group), '下图是一个正方形，面积是多少？').spec).not.toBeNull();
    });

    it('形状冲突继续使用完整旧SVG，没有可用结果时返回无配图', () => {
        const question = '下图是一个正方形，面积是多少？';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧图</text></svg>';
        expect(parseFigure('true', legacy, raw(triangle), question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(triangle), question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

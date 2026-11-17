import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (value: unknown) => JSON.stringify(value);
const rectangle = (baseLabel?: string, heightLabel?: string, topLabel?: string) => ({
    type: 'area_geometry', shape: 'rectangle', width: 60, height: 40,
    baseLabel, heightLabel, topLabel,
});
const cuboid = (widthLabel?: string, depthLabel?: string, heightLabel?: string) => ({
    type: 'solid_geometry', shape: 'cuboid', width: 60, depth: 40, height: 30,
    widthLabel, depthLabel, heightLabel,
});
const examples = [
    {
        name: '矩形长宽', spec: rectangle('6cm', '4cm'),
        valid: '下图是一个长方形，长6厘米，宽4厘米。',
        invalid: '下图是一个长方形，长7厘米，宽4厘米。',
    },
    {
        name: '正方形边长', spec: { ...rectangle('5cm', '5cm', '5cm'), shape: 'square', height: 60 },
        valid: '下图是一个正方形，边长5厘米。',
        invalid: '下图是一个正方形，边长6厘米。',
    },
    {
        name: '三角形底和高', spec: { ...rectangle('6cm', '4cm', 'A'), shape: 'triangle' },
        valid: '下图是一个三角形，底6厘米，高4厘米。',
        invalid: '下图是一个三角形，底7厘米，高4厘米。',
    },
    {
        name: '平行四边形底和高', spec: { ...rectangle('6cm', '4cm', '6cm'), shape: 'parallelogram', offset: 10 },
        valid: '下图是一个平行四边形，底6厘米，高4厘米。',
        invalid: '下图是一个平行四边形，底6厘米，高5厘米。',
    },
    {
        name: '梯形上下底', spec: { ...rectangle('6cm', '4cm', '3cm'), shape: 'trapezoid', topWidth: 30 },
        valid: '下图是一个梯形，上底3厘米，下底6厘米，高4厘米。',
        invalid: '下图是一个梯形，上底6厘米，下底3厘米，高4厘米。',
    },
    {
        name: '长方体长宽高', spec: cuboid('6cm', '4cm', '3cm'),
        valid: '下图是一个长方体，长6厘米，宽4厘米，高3厘米。',
        invalid: '下图是一个长方体，长6厘米，宽4厘米，高5厘米。',
    },
    {
        name: '正方体棱长', spec: { ...cuboid('5cm', '5cm', '5cm'), shape: 'cube', depth: 60, height: 60 },
        valid: '下图是一个正方体，棱长5厘米。',
        invalid: '下图是一个正方体，棱长6厘米。',
    },
];

describe.each(examples)('题干与模板尺寸：$name', ({ spec, valid, invalid }) => {
    it('明确对应的尺寸一致时保留，冲突时整图回退', () => {
        expect(parseFigureSpec(raw(spec), valid)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw(spec), invalid)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it('后续求面积或体积不取消前面的尺寸条件', () => {
        expect(parseFigureSpec(raw(spec), `${valid}求面积或体积。`)).not.toBeNull();
        expect(parseFigureSpec(raw(spec), `${invalid}求面积或体积。`)).toBeNull();
    });

    it('回退保留完整旧图，不改坐标、尺寸或标注', () => {
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整尺寸图</text></svg>';
        expect(parseFigure('true', legacy, before, invalid)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, before, invalid)).toEqual({ hasFigure: true, figureSvg: null });
        expect(raw(spec)).toBe(before);
    });
});

describe('模板尺寸的单位、方向和归属', () => {
    it('没有标点的连续长宽声明仍逐项核对，不漏掉后续错误尺寸', () => {
        const spec = rectangle('6cm', '4cm');
        for (const valid of ['下图是一个长方形，长6厘米宽4厘米。', '下图是一个长方形，长6cm宽4cm。']) {
            expect(parseFigureSpec(raw(spec), valid), valid).not.toBeNull();
        }
        for (const invalid of ['下图是一个长方形，长7厘米宽4厘米。', '下图是一个长方形，长6厘米宽5厘米。', '下图是一个长方形，长7cm宽4cm。']) {
            expect(parseFigureSpec(raw(spec), invalid), invalid).toBeNull();
        }

        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整尺寸图</text></svg>';
        expect(parseFigure('true', legacy, raw(spec), '下图是一个长方形，长7厘米宽4厘米。'))
            .toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('括号或方括号包住的尺寸仍逐项核对', () => {
        const spec = raw(rectangle('6cm', '4cm'));
        const examples = [
            ['（长6厘米，宽4厘米）', '（长7厘米，宽4厘米）'],
            ['(长6cm,宽4cm)', '(长7cm,宽4cm)'],
            ['【长6厘米，宽4厘米】', '【长7厘米，宽4厘米】'],
            ['[长6厘米，宽4厘米]', '[长7厘米，宽4厘米]'],
            ['［长6厘米，宽4厘米］', '［长7厘米，宽4厘米］'],
            ['｛长6厘米，宽4厘米｝', '｛长7厘米，宽4厘米｝'],
            ['{长6厘米，宽4厘米}', '{长7厘米，宽4厘米}'],
            ['〔长6厘米，宽4厘米〕', '〔长7厘米，宽4厘米〕'],
        ];

        for (const [valid, invalid] of examples) {
            const validQuestion = `下图是一个长方形${valid}。`;
            const invalidQuestion = `下图是一个长方形${invalid}。`;
            expect(parseFigureSpec(spec, validQuestion), validQuestion).not.toBeNull();
            expect(parseFigureSpec(spec, invalidQuestion), invalidQuestion).toBeNull();
            expect(renderFigureSpecDetailed(spec, invalidQuestion)).toMatchObject({
                svg: null, diagnostic: { reason: 'semantic_validation' },
            });
        }

        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原始长方形</text></svg>';
        expect(parseFigure('true', legacy, spec, '下图是一个长方形（长7厘米，宽4厘米）。'))
            .toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('图形名称后的“的”不应让长宽尺寸声明漏检', () => {
        const spec = raw(rectangle('6cm', '4cm'));
        const examples = [
            ['下图是一个长方形的长为6厘米，宽为4厘米。', '下图是一个长方形的长为7厘米，宽为4厘米。'],
            ['下图是一个长方形的长6厘米，宽4厘米。', '下图是一个长方形的长7厘米，宽4厘米。'],
        ];

        for (const [valid, invalid] of examples) {
            expect(parseFigureSpec(spec, valid), valid).not.toBeNull();
            expect(parseFigureSpec(spec, invalid), invalid).toBeNull();
        }
    });

    it.each([
        ['1分米', '10cm'], ['1/2m', '50cm'], ['1又1/2cm', '15mm'], ['0.3cm', '3mm'],
    ])('尺寸按精确单位换算核对但保留原文：%s', (questionValue, label) => {
        const spec = { ...rectangle(label, '4cm', label), shape: 'parallelogram', offset: 10 };
        expect(parseFigureSpec(raw(spec), `下图是平行四边形，底${questionValue}，高4厘米。`)).toMatchObject({ baseLabel: label });
        expect(parseFigureSpec(raw(spec), '下图是平行四边形，底99厘米，高4厘米。')).toBeNull();
    });

    it('没有方向说明的矩形和长方体允许水平长宽交换，标注文字指定方向时遵守文字', () => {
        const question = '下图是一个长方形，长6厘米，宽4厘米。';
        expect(parseFigureSpec(raw(rectangle('4cm', '6cm')), question)).not.toBeNull();
        expect(parseFigureSpec(raw(rectangle('宽4cm', '长6cm')), question)).not.toBeNull();
        expect(parseFigureSpec(raw(rectangle('长4cm', '宽6cm')), question)).toBeNull();
        const solidQuestion = '下图是一个长方体，长6厘米，宽4厘米，高3厘米。';
        expect(parseFigureSpec(raw(cuboid('4cm', '6cm', '3cm')), solidQuestion)).not.toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', '3cm', '4cm')), solidQuestion)).toBeNull();
    });

    it('部分已知尺寸不能重复借用同一个标注，多种未知标签不擅自补值', () => {
        const question = '下图是长方形，长6厘米，宽6厘米。';
        expect(parseFigureSpec(raw(rectangle('6cm', '4cm')), question)).toBeNull();
        for (const unknown of [undefined, '', '?', 'x', '约4cm', '4cm²', '4in']) {
            expect(parseFigureSpec(raw(rectangle('6cm', unknown)), question), unknown).not.toBeNull();
        }
        expect(parseFigureSpec(raw(rectangle('6', '4')), '下图是长方形，长7厘米，宽5厘米。')).not.toBeNull();
        expect(parseFigureSpec(raw(rectangle('6', '4')), '下图是长方形，长7，宽5。')).toBeNull();
    });

    it('三角形顶点标注不是边长，平行四边形斜边不是高，梯形单写底不选上下底', () => {
        const triangle = { ...rectangle('6cm', '4cm', '3cm'), shape: 'triangle' };
        expect(parseFigureSpec(raw(triangle), '下图是三角形，底6厘米，高4厘米。')).not.toBeNull();
        expect(parseFigureSpec(raw(triangle), '下图是三角形，底6厘米，高3厘米。')).toBeNull();
        const parallelogram = { ...rectangle('6cm', '4cm'), shape: 'parallelogram', offset: 10 };
        expect(parseFigureSpec(raw(parallelogram), '下图是平行四边形，边长3厘米。')).not.toBeNull();
        const trapezoid = { ...rectangle('6cm', '4cm', '3cm'), shape: 'trapezoid', topWidth: 30 };
        expect(parseFigureSpec(raw(trapezoid), '下图是梯形，底9厘米。')).not.toBeNull();
    });

    it('英文尺寸声明及独立尺寸句也须核对', () => {
        for (const question of [
            'The figure is a rectangle with length 7 cm and width 4 cm.',
            'The figure is a rectangle. Its length is 7 cm, width is 4 cm.',
            '下图是长方形。其长为7厘米，宽为4厘米。',
        ]) {
            expect(parseFigureSpec(raw(rectangle('7cm', '4cm')), question), question).not.toBeNull();
            expect(parseFigureSpec(raw(rectangle('6cm', '4cm')), question), question).toBeNull();
        }
        const solidQuestion = 'The solid is a cuboid with length 6 cm, width 4 cm and height 5 cm.';
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '5cm')), solidQuestion)).not.toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '3cm')), solidQuestion)).toBeNull();
    });

    it.each([
        ['length 6 cm', 'width 4 cm'],
        ['width 4 cm', 'length 6 cm'],
        [' Length is 6 cm ', 'Width: 4 cm'],
        ['长度为6cm', '宽度是4cm'],
    ])('图内尺寸前缀参与比较但保留原文：%s / %s', (base, height) => {
        const question = 'The figure is a rectangle with length 6 cm and width 4 cm.';
        expect(parseFigureSpec(raw(rectangle(base, height)), question)).toMatchObject({ baseLabel: base.trim(), heightLabel: height.trim() });
        expect(parseFigureSpec(raw(rectangle(base, height)), question.replace('6 cm', '7 cm'))).toBeNull();
    });

    it('英文标注不能通过调换长宽绕过明确方向', () => {
        const question = 'The figure is a rectangle with length 6 cm and width 4 cm.';
        expect(parseFigureSpec(raw(rectangle('length 4 cm', 'width 6 cm')), question)).toBeNull();
        expect(parseFigureSpec(raw(rectangle('width 6 cm', 'length 4 cm')), question)).toBeNull();
        expect(parseFigureSpec(raw(cuboid('length 6 cm', 'width 4 cm', 'height 3 cm')),
            'The solid is a cuboid with length 6 cm, width 4 cm and height 5 cm.')).toBeNull();
    });

    it('立体题只画一个面或平面题使用立体示意时不跨类别套用尺寸', () => {
        expect(parseFigureSpec(raw(rectangle('6cm', '4cm')),
            '下图是长方体，长7厘米，宽5厘米，高3厘米。')).not.toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '3cm')),
            '下图是长方形，长7厘米，宽5厘米。')).not.toBeNull();
    });

    it('带维度前缀的上底、下底、底和高也须精确比较', () => {
        const spec = { ...rectangle('下底6cm', '高度4cm', '上底3cm'), shape: 'trapezoid', topWidth: 30 };
        expect(parseFigureSpec(raw(spec), '下图是梯形，上底3厘米，下底6厘米，高4厘米。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '下图是梯形，上底3厘米，下底6厘米，高5厘米。')).toBeNull();
        const triangle = { ...rectangle('base 6 cm', 'height 4 cm', 'A'), shape: 'triangle' };
        expect(parseFigureSpec(raw(triangle), 'The figure is a triangle with base 6 cm and height 5 cm.')).toBeNull();
    });

    it('精确小数和全角题干不受浮点舍入影响', () => {
        const spec = raw(rectangle('0.30000000000000001cm', '4cm'));
        expect(parseFigureSpec(spec, '下图是长方形，长０．３０００００００００００００００１厘米，宽４厘米。')).not.toBeNull();
        expect(parseFigureSpec(spec, '下图是长方形，长0.3厘米，宽4厘米。')).toBeNull();
    });

    it('同一尺寸多处明确声明须同时满足，不用后文覆盖冲突', () => {
        expect(parseFigureSpec(raw(rectangle('6cm', '4cm')),
            '下图是长方形，长6厘米，宽4厘米。其长为7厘米。')).toBeNull();
    });

    it.each([
        ['下图是长方体，长宽高分别是4、3、2厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长、宽、高分别为4厘米、3厘米、2厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长、宽和高分别是4、3、2厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长宽高分别为1/2米、30厘米、200毫米。', cuboid('50cm', '3dm', '20cm')],
        ['下图是三角形，底和高分别为6厘米和4厘米。', { ...rectangle('6cm', '4cm'), shape: 'triangle', topLabel: 'A' }],
        ['下图是长方体。其长、宽和高分别为4 cm、3 cm and 2 cm。', cuboid('4cm', '3cm', '2cm')],
        ['The figure is a cuboid. Its length, width, and height are 4 cm, 3 cm and 2 cm respectively.', cuboid('4cm', '3cm', '2cm')],
    ])('按顺序精确核对压缩的长宽高列表：%s', (question, spec) => {
        expect(parseFigureSpec(raw(spec), question)).not.toBeNull();
    });

    it.each([
        ['下图是长方体，长宽高分别是4、3、5厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长、宽、高分别为4厘米、3厘米、5厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长、宽和高分别是4、3、5厘米。', cuboid('4cm', '3cm', '2cm')],
        ['下图是长方体，长宽高分别为1/2米、30厘米、250毫米。', cuboid('50cm', '3dm', '20cm')],
        ['The figure is a cuboid. Its length, width, and height are 4 cm, 3 cm and 5 cm respectively.', cuboid('4cm', '3cm', '2cm')],
    ])('压缩列表中的任一尺寸冲突都使结构化图回退：%s', (question, spec) => {
        expect(parseFigureSpec(raw(spec), question)).toBeNull();
    });

    it('值列表数量不符或作为提问时不强加尺寸，并保留旧SVG回退', () => {
        const question = '下图是长方体，长宽高分别是4、3厘米吗？';
        const figure = cuboid('4cm', '3cm', '2cm');
        expect(parseFigureSpec(raw(figure), question)).not.toBeNull();

        const conflict = '下图是长方体，长宽高分别是4、3、5厘米。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧立体图</text></svg>';
        expect(parseFigure('true', legacy, raw(figure), conflict)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(figure), conflict)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('不从其它物体的 respectively 列表窃取尺寸', () => {
        const question = 'The figure is a cuboid. A box has length, width, and height 4 cm, 3 cm and 5 cm respectively.';
        expect(parseFigureSpec(raw(cuboid('4cm', '3cm', '2cm')), question)).not.toBeNull();
    });

    it('英文 respectively 两维列表按顺序核对长方形长宽', () => {
        const spec = raw(rectangle('6cm', '4cm'));
        expect(parseFigureSpec(spec,
            'The figure is a rectangle. Its length and width are 6 cm and 4 cm respectively.')).not.toBeNull();
        expect(parseFigureSpec(spec,
            'The figure is a rectangle. Its length and width are 7 cm and 4 cm respectively.')).toBeNull();
    });

    it('英文 respectively 疑问及维度／数值数量不匹配时不建立尺寸断言', () => {
        const spec = raw(cuboid('4cm', '3cm', '2cm'));
        expect(parseFigureSpec(spec,
            'The figure is a cuboid. Its length, width, and height are 4 cm, 3 cm and 5 cm respectively?')).not.toBeNull();
        expect(parseFigureSpec(spec,
            'The figure is a cuboid. Its length, width, and height are 4 cm and 3 cm respectively.')).not.toBeNull();
    });

    it.each([
        '下图是长方形。小明有一张卡片，长7厘米，宽5厘米。',
        '下图是长方形，长6厘米，宽4厘米。作一条辅助线，长7厘米。',
        'The figure is a rectangle. A pencil has length 7 cm.',
    ])('不借用后文其它物体的尺寸：%s', (question) => {
        expect(parseFigureSpec(raw(rectangle('6cm', '4cm')), question)).not.toBeNull();
    });

    it('容器深度不猜测为水平或竖直方向，图内有明确深度标签时才比较', () => {
        const question = '下图是长方体，长6厘米，宽4厘米，深3厘米。';
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '3cm')), question)).not.toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '深3cm')), question)).not.toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', '4cm', '深5cm')), question)).toBeNull();
        expect(parseFigureSpec(raw(cuboid('6cm', 'depth 4cm', '3cm')),
            'The solid is a cuboid with depth 5 cm.')).toBeNull();
    });

    it('疑问、否定、假设、引用和另一个图形的尺寸不强加到主图', () => {
        const spec = raw(rectangle('6cm', '4cm'));
        for (const question of [
            '下图是长方形，长7厘米吗？', '下图是长方形，长不为7厘米。',
            '下图是长方形，如果长7厘米，求面积。', '下图是长方形，证明长7厘米。',
            '下图是长方形，“长7厘米”这句话对吗？',
            '下图是长方形，长7厘米，这句话正确吗？',
            '下图是长方形。另一个长方形长7厘米，宽4厘米。',
            'The figure is a rectangle. Another rectangle has length 7 cm.',
            '下图是长方形，周长7厘米，宽4厘米。',
            '下图是长方形，长7+1厘米，宽4厘米。',
            '下图是长方形，长7厘米+1厘米，宽4厘米。',
            '下图是长方形，长7厘米²，宽4厘米。',
            '下图是长方形，长7,000厘米，宽4厘米。',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
    });

    it('只在主图声明可明确对应时核对，不把故事中的物体尺寸套到配图', () => {
        const spec = raw(rectangle('6cm', '4cm'));
        for (const question of [
            '有一个长方形，长7厘米，宽4厘米。',
            '图中有两个长方形，长7厘米，宽4厘米。',
            '下图是长方体的底面，长7厘米，宽4厘米。',
            '下图是长方形与三角形的拼接，长7厘米。',
            '判断下图是长方形，长7厘米，宽4厘米。',
        ]) {
            expect(parseFigureSpec(spec, question), question).not.toBeNull();
        }
    });

    it('图组只对照明确分段的子图尺寸，错误子图使整组回退', () => {
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: rectangle('6cm', '4cm') },
            { label: '乙', figure: cuboid('6cm', '4cm', '3cm') },
        ] };
        const valid = '图甲中：下图是长方形，长6厘米，宽4厘米；图乙中：下图是长方体，长6厘米，宽4厘米，高3厘米。';
        const invalid = valid.replace('高3厘米', '高5厘米');
        expect(parseFigureSpec(raw(group), valid)).not.toBeNull();
        expect(parseFigureSpec(raw(group), invalid)).toBeNull();
        const compressed = '图甲中：下图是长方形，长宽分别是6、4厘米；图乙中：下图是长方体，长宽高分别是6、4、5厘米。';
        expect(parseFigureSpec(raw(group), compressed)).toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整尺寸图组</text></svg>';
        expect(parseFigure('true', legacy, raw(group), invalid)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(group), invalid)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

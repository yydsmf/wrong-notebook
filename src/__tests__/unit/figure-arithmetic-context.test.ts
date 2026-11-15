import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec } from '@/lib/figure-spec';

const raw = (top: string, bottom: string, operation: '×' | '+' | '-' | '÷' = '×') => JSON.stringify({
    type: 'vertical_arithmetic', top, bottom, operation,
});

describe('竖式题干的完整算式边界', () => {
    it.each([
        ['3.4', '25', '计算3.4×25。'],
        ['34', '2.5', '计算34×2.5。'],
        ['-34', '25', '计算-34×25。'],
        ['34', '-25', '计算34×-25。'],
        ['34', '25', '计算 $34 \\times 25$。'],
        ['34', '25', '计算 $34 \\cdot 25$。'],
        ['34', '25', 'Calculate 34 times 25.'],
    ])('完整保留 %s 和 %s 的数值条件：%s', (top, bottom, question) => {
        expect(parseFigureSpec(raw(top, bottom), question)).not.toBeNull();
        expect(parseFigureSpec(raw('99', bottom), question)).toBeNull();
        expect(parseFigureSpec(raw(top, '99'), question)).toBeNull();
    });

    it('小数的符号和数值不得被整数后缀替代', () => {
        expect(parseFigureSpec(raw('4', '25'), '计算3.4×25。')).toBeNull();
        expect(parseFigureSpec(raw('34', '2'), '计算34×2.5。')).toBeNull();
        expect(parseFigureSpec(raw('34', '25'), '计算-34×25。')).toBeNull();
        expect(parseFigureSpec(raw('003.400', '+25.0'), '计算3.4×25。')).not.toBeNull();
    });

    it.each([
        '观察1/2的图示，再观察竖式。',
        '请观察34×25+7的计算步骤。',
        '请观察(34+7)×25的计算步骤。',
        '请观察3e2×25的计算步骤。',
        '请观察2a×25的计算步骤。',
        '请观察34×25²的计算步骤。',
        '请观察12,345×25的计算步骤。',
        '计算 $\\frac{34}{25}\\times 7$。',
    ])('不把复合式或分数片段强加给单个竖式：%s', (question) => {
        expect(parseFigureSpec(raw('x', 'y'), question)).not.toBeNull();
    });

    it('一个候选完整而另一个带括号时仍不擅自选择', () => {
        const question = '比较34×25与(43×25)的积。';
        expect(parseFigureSpec(raw('34', '25'), question)).not.toBeNull();
        expect(parseFigureSpec(raw('43', '25'), question)).not.toBeNull();
    });

    it('位数条件保留完整小数乘数且不截断长整数', () => {
        expect(parseFigureSpec(raw('□□', '25.5'), '观察两位数乘25.5的竖式。')).not.toBeNull();
        expect(parseFigureSpec(raw('□□', '25'), '观察两位数乘25.5的竖式。')).toBeNull();
        expect(parseFigureSpec(raw('□□', '123456789'), '观察两位数乘123456789的竖式。')).not.toBeNull();
        expect(parseFigureSpec(raw('□□', '12345678'), '观察两位数乘123456789的竖式。')).toBeNull();
    });

    it('英文条件核对两个操作数的位数', () => {
        const question = 'a two-digit number multiplied by a three-digit number';
        expect(parseFigureSpec(raw('□□', '□□□'), question)).not.toBeNull();
        expect(parseFigureSpec(raw('□□', '□□'), question)).toBeNull();
    });

    it('更长的位数词不截取成支持范围内的位数', () => {
        expect(parseFigureSpec(raw('x', '25'), '观察十二位数乘25的竖式。')).not.toBeNull();
        expect(parseFigureSpec(raw('1234', '25'), '观察十二位数乘25的竖式。')).not.toBeNull();
    });

    it('冲突仍回退完整旧 SVG，不改写结构或填空', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有完整竖式</text></svg>';
        expect(parseFigure('true', legacy, raw('4', '25'), '计算3.4×25。')).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it.each([
        ['+', '计算3.4加2.5。'],
        ['+', 'Calculate 3.4 plus 2.5.'],
        ['-', '计算3.4减2.5。'],
        ['-', 'Calculate 3.4 minus 2.5.'],
        ['÷', '计算3.4除以2.5。'],
        ['÷', 'Calculate 3.4 divided by 2.5.'],
        ['÷', '计算 $3.4 \\div 2.5$。'],
    ] as const)('完整核对运算符 %s：%s', (operation, question) => {
        expect(parseFigureSpec(raw('3.4', '2.5', operation), question)).not.toBeNull();
        expect(parseFigureSpec(raw('3.4', '2.5', '×'), question)).toBeNull();
        expect(parseFigureSpec(raw('4', '2.5', operation), question)).toBeNull();
    });

    it('有限小数精确比较，不使用浮点近似，保存的原文不改变', () => {
        const question = '计算0.3000000000000001×25。';
        expect(parseFigureSpec(raw('0.3', '25'), question)).toBeNull();
        expect(parseFigureSpec(raw('.30000000000000010', '25.00'), question)).toMatchObject({
            top: '.30000000000000010', bottom: '25.00',
        });
        expect(parseFigureSpec(raw('-.50', '25.00'), '计算 −.5 × 25。')).not.toBeNull();
    });

    it('全角数字和符号用于比较，纯整数题及等号前的算式仍正常核对', () => {
        expect(parseFigureSpec(raw('3.4', '25'), '计算３．４×２５。')).not.toBeNull();
        expect(parseFigureSpec(raw('4', '25'), '计算３．４×２５。')).toBeNull();
        expect(parseFigureSpec(raw('34', '25'), '20. 请列竖式计算34×25=850。')).not.toBeNull();
        expect(parseFigureSpec(raw('43', '25'), '20. 请列竖式计算34×25=850。')).toBeNull();
        expect(parseFigureSpec(raw('34', '25'), '计算 $34\\,\\times\\,25$。')).not.toBeNull();
        expect(parseFigureSpec(raw('43', '25'), '计算 $34\\,\\times\\,25$。')).toBeNull();
    });

    it('数值相等的重复表述仍有唯一条件，不因前导零和小数尾零失去校验', () => {
        const question = '列竖式计算34×25，也就是034.0×25.00。';
        expect(parseFigureSpec(raw('34', '25'), question)).not.toBeNull();
        expect(parseFigureSpec(raw('43', '25'), question)).toBeNull();
    });

    it('中英文位数条件的分数和连续运算不截取整数乘数', () => {
        for (const question of ['两位数乘1/2', '两位数乘25+3', 'a two-digit number times 1/2']) {
            expect(parseFigureSpec(raw('□□', 'x'), question)).not.toBeNull();
        }
    });
});

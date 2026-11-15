import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (top: string, bottom = '25') => JSON.stringify({ type: 'vertical_arithmetic', operation: '×', top, bottom });
const question = '观察两位数乘25的乘法竖式。';

describe('明确整数位数与操作数的数值交叉校验', () => {
    it.each(['3.4', '.34', '34.000000000001', '03', '003', '+9', '-9', '−9.00', '0.0'])('非整数或位数不足的已知数应回退：%s', (top) => {
        expect(parseFigureSpecDetailed(raw(top), question)).toMatchObject({ spec: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each(['+345', '-345', '00345.00'])('不能用符号或前导零绕过实际位数：%s', (top) => {
        expect(parseFigureSpecDetailed(raw(top), question).spec).toBeNull();
    });

    it('很小的非零小数部分不能被浮点舍入成整数', () => {
        const top = '34.000000000000001';
        expect(parseFigureSpecDetailed(raw(top)).spec).toMatchObject({ top });
        expect(parseFigureSpecDetailed(raw(top), question).spec).toBeNull();
    });

    it('零和负零按一位整数比较，但不改变显示的写法', () => {
        for (const top of ['0', '-0.0', '000.0']) {
            expect(parseFigureSpecDetailed(raw(top), 'a one-digit number times 25').spec).toMatchObject({ top });
            expect(parseFigureSpecDetailed(raw(top), question).spec).toBeNull();
        }
    });

    it.each(['34', '+34', '-34', '−34', '034', '0034.00', '34.0', '+34.00'])('数值确为两位整数时保留原文：%s', (top) => {
        expect(parseFigureSpecDetailed(raw(top), question).spec).toMatchObject({ top, bottom: '25' });
        const rendered = renderFigureSpecDetailed(raw(top), question);
        expect(rendered.diagnostic.reason).toBe('ok');
        expect(rendered.svg).not.toBeNull();
    });

    it.each([
        ['34', '2.5'], ['34', '03'], ['34', '-9'], ['3.4', '25'],
    ])('中英文的两边位数条件均生效：%s × %s', (top, bottom) => {
        for (const text of ['观察两位数乘两位数的竖式。', 'a two-digit number multiplied by a two-digit number']) {
            expect(parseFigureSpecDetailed(raw(top, bottom), text).spec).toBeNull();
        }
    });

    it.each(['3.4', '-9', '03'])('没有位数条件的小数或完整算式仍沿用原规则：%s', (top) => {
        expect(parseFigureSpecDetailed(raw(top), `计算${top}×25。`).spec).toMatchObject({ top });
    });

    it.each(['□□', '3□', '?4', '__', 'x', 'a+b', '34/2', '1e2'])('未解出的填空及复杂表达式不求值或补答案：%s', (top) => {
        expect(parseFigureSpecDetailed(raw(top), question).spec).toMatchObject({ top });
    });

    it('明确数位的填空仍按原有容量核对', () => {
        expect(parseFigureSpecDetailed(raw('□'), question).spec).toBeNull();
        expect(parseFigureSpecDetailed(raw('□□□'), question).spec).toBeNull();
        expect(parseFigureSpecDetailed(raw('□□'), question).spec).toMatchObject({ top: '□□' });
    });

    it('非整数冲突继续完整旧SVG回退，无旧图时不产生新图', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原有竖式</text></svg>';
        expect(parseFigure('true', legacy, raw('3.4'), question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw('3.4'), question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

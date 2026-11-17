import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧除法图</text></svg>';

const unknownDividend = {
    type: 'vertical_arithmetic', operation: '÷', top: '8□7', bottom: '7',
    divisionSteps: [
        { value: '8', subtract: '7', shift: 2 },
        { value: '19', subtract: '14', shift: 1 },
        { value: '57', subtract: '56', shift: 0 },
    ],
};

describe('已知除数的未知被除数步骤校验', () => {
    it.each([
        { divisionSteps: [{ value: '8', subtract: '0', shift: 2 }] },
        { divisionSteps: [...unknownDividend.divisionSteps.slice(0, 1), { value: '19', subtract: '7', shift: 1 }] },
        { divisionSteps: [...unknownDividend.divisionSteps.slice(0, 1), { value: '70', subtract: '70', shift: 1 }] },
    ])('拒绝当前值与减数不符合一次长除法步骤的结构：%j', ({ divisionSteps }) => {
        const spec = { ...unknownDividend, divisionSteps };

        expect(parseFigureSpec(raw(spec))).toBeNull();
        expect(renderFigureSpec(raw(spec))).toBeNull();
        expect(parseFigure('true', legacy, raw(spec)).figureSvg).toBe(legacy);
    });

    it('保留正确的未知被除数步骤以及未知格本身', () => {
        expect(parseFigureSpec(raw(unknownDividend))).toMatchObject({
            top: '8□7',
            divisionSteps: unknownDividend.divisionSteps,
        });
        expect(renderFigureSpec(raw(unknownDividend))).not.toBeNull();
    });

    it.each([
        {
            type: 'vertical_arithmetic', operation: '÷', top: '1□23', bottom: '1',
            divisionSteps: [
                { value: '1', subtract: '1', shift: 3 },
                { value: '3', subtract: '3', shift: 0 },
            ],
        },
        {
            type: 'vertical_arithmetic', operation: '÷', top: '8□7', bottom: '7',
            divisionSteps: [
                { value: '8', subtract: '7', shift: 2 },
                { value: '19', subtract: '14', shift: 1 },
                { value: '55', subtract: '49', shift: 0 },
            ],
        },
        {
            type: 'vertical_arithmetic', operation: '÷', top: '23□', bottom: '1',
            divisionSteps: [{ value: '□', subtract: '□', shift: 0 }],
        },
    ])('拒绝遗漏已知非零商位或与被除数明示数位不符：%j', (spec) => {
        expect(parseFigureSpec(raw(spec))).toBeNull();
        expect(renderFigureSpec(raw(spec))).toBeNull();
        expect(parseFigure('true', legacy, raw(spec)).figureSvg).toBe(legacy);
    });

    it('允许被跳过的已知零商位，并保留后续未知答案格', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '÷', top: '100□', bottom: '5',
            divisionSteps: [
                { value: '10', subtract: '10', shift: 2 },
                { value: '□', subtract: '□', shift: 0 },
            ],
        };

        expect(parseFigureSpec(raw(spec))).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });

    it('未知被除数数位有对应占位步骤时保留完整列结构', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '÷', top: '1□23', bottom: '1',
            divisionSteps: [
                { value: '1', subtract: '1', shift: 3 },
                { value: '2', subtract: '2', shift: 2 },
                { value: '□', subtract: '□', shift: 1 },
                { value: '3', subtract: '3', shift: 0 },
            ],
        };

        expect(parseFigureSpec(raw(spec))).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });
});

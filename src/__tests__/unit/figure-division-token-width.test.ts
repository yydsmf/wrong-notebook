import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧除法图</text></svg>';

describe('未知除法中间行的有效数位', () => {
    it.each([
        { value: '□□', subtract: '□', shift: 2 },
        { value: '□', subtract: '□□', shift: 2 },
        { value: '□□□', subtract: '□', shift: 1 },
        { value: '□', subtract: '□□□□', shift: 0 },
        { value: '0000', subtract: '0', shift: 0 },
        { value: '0', subtract: '0000', shift: 0 },
    ])('未知值也不能超过当前被除数剩余的数位：%j', (step) => {
        const spec = {
            type: 'vertical_arithmetic', operation: '÷', top: '□□□', bottom: '□',
            divisionSteps: [step],
        };

        expect(parseFigureSpec(raw(spec))).toBeNull();
        expect(renderFigureSpec(raw(spec))).toBeNull();
        expect(parseFigure('true', legacy, raw(spec)).figureSvg).toBe(legacy);
    });

    it('保留不超出对应数位的未知步骤', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '÷', top: '□□□', bottom: '□',
            divisionSteps: [
                { value: '□', subtract: '□', shift: 2 },
                { value: '□□', subtract: '□□', shift: 1 },
                { value: '□□□', subtract: '□□□', shift: 0 },
            ],
        };

        expect(parseFigureSpec(raw(spec))).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const division = {
    type: 'vertical_arithmetic', operation: '÷', top: '847', bottom: '7', result: '121', remainder: '0',
    divisionSteps: [
        { value: '8', subtract: '7', shift: 2 },
        { value: '14', subtract: '14', shift: 1 },
        { value: '7', subtract: '7', shift: 0 },
    ],
};
const raw = (spec: unknown) => JSON.stringify(spec);
const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧除法图</text></svg>';

describe('整数除法的完整步骤与作答保真', () => {
    it('显示带下一位后的中间行和最后余数，不只堆叠减数', () => {
        const svg = renderFigureSpec(raw(division));
        expect(svg).not.toBeNull();
        const root = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Array.from(root.querySelectorAll('text[data-arithmetic-row]'));
        expect(rows.map((row) => [row.getAttribute('data-arithmetic-row'), row.textContent])).toEqual([
            ['division-quotient', '121'], ['division-divisor', '7'], ['division-dividend', '847'],
            ['division-value', '8'], ['division-subtract', '7'],
            ['division-value', '14'], ['division-subtract', '14'],
            ['division-value', '7'], ['division-subtract', '7'], ['division-remainder', '余数 0'],
        ]);
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/u).map(Number);
        const dividend = root.querySelector('[data-arithmetic-row="division-dividend"]')!;
        const unit = positions(dividend).at(-1)!;
        for (const row of rows.filter((element) => ['division-value', 'division-subtract'].includes(element.getAttribute('data-arithmetic-row')!))) {
            expect(positions(row).at(-1)).toBe(unit - Number(row.getAttribute('data-arithmetic-shift')) * 30);
        }
        expect(renderFigureSpec(raw(division))).toBe(svg);
    });

    it('步骤标签使用预留的左侧标签列，不与除数数位列重叠', () => {
        const spec = {
            ...division,
            divisionSteps: division.divisionSteps.map((step, index) => index === 0 ? { ...step, label: '甲' } : step),
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const root = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const label = Array.from(root.querySelectorAll('text')).find((element) => element.textContent === '甲')!;
        const divisor = root.querySelector('[data-arithmetic-row="division-divisor"]')!;
        const labelRight = Number(label.getAttribute('x'));
        const divisorColumnLeft = Number(divisor.getAttribute('x')) - 15;

        expect(labelRight).toBeLessThanOrEqual(divisorColumnLeft - 16);
    });

    it.each([
        { top: '1005', bottom: '5', result: '201', remainder: '0', divisionSteps: [
            { value: '10', subtract: '10', shift: 2 }, { value: '5', subtract: '5', shift: 0 },
        ] },
        { top: '1005', bottom: '5', result: '201', remainder: '0', divisionSteps: [
            { value: '10', subtract: '10', shift: 2 }, { value: '0', subtract: '0', shift: 1 }, { value: '5', subtract: '5', shift: 0 },
        ] },
        { top: '103', bottom: '5', result: '20', remainder: '3', divisionSteps: [{ value: '10', subtract: '10', shift: 1 }] },
        { top: '859', bottom: '7', result: '122', remainder: '5', divisionSteps: [
            { value: '8', subtract: '7', shift: 2 }, { value: '15', subtract: '14', shift: 1 }, { value: '19', subtract: '14', shift: 0 },
        ] },
        { top: '5', bottom: '12', result: '0', remainder: '5', divisionSteps: [{ value: '5', subtract: '0', shift: 0 }] },
        { top: '0', bottom: '7', result: '0', remainder: '0', divisionSteps: [] },
    ])('$top ÷ $bottom 支持内部零、末尾零、有余数、商零', (spec) => {
        expect(renderFigureSpec(raw({ ...division, ...spec }))).not.toBeNull();
    });

    it('保留大整数的精确解析，但超出画布宽度时不强行缩小到不可读', () => {
        const spec = {
            ...division,
            top: '99999999999999999', bottom: '99999999999999998', result: '1', remainder: '1',
            divisionSteps: [{ value: '99999999999999999', subtract: '99999999999999998', shift: 0 }],
        };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ result: '1', remainder: '1' });
        expect(renderFigureSpec(raw(spec))).toBeNull();
    });

    it('纯整数商和余数可以安全复算，但逐步数字必须保留识别结果', () => {
        const wrongResult = { ...division, result: '999', remainder: '8' };
        expect(parseFigureSpec(raw(wrongResult))).toMatchObject({ result: '121', remainder: '0', divisionSteps: division.divisionSteps });

        const blank = {
            ...division, result: '1□1', remainder: '?', divisionSteps: [
                { value: '8', subtract: '□', shift: 2 }, { value: '1□', subtract: '1□', shift: 1 }, { value: '?', subtract: '_', shift: 0 },
            ],
        };
        expect(parseFigureSpec(raw(blank))).toMatchObject(blank);
    });

    it('只有题目时允许保留空白结构，不自动补写商、余数和步骤', () => {
        const minimal = { type: 'vertical_arithmetic', operation: '÷', top: '847', bottom: '7' };
        const parsed = parseFigureSpec(raw(minimal));
        expect(parsed).toMatchObject({ top: '847', bottom: '7', divisionSteps: [] });
        expect(parsed).not.toHaveProperty('result');
        expect(parsed).not.toHaveProperty('remainder');
        const svg = renderFigureSpec(raw(minimal))!;
        expect(svg).not.toContain('division-quotient');
        expect(svg).not.toContain('division-subtract');
        expect(svg).not.toContain('division-remainder');
    });

    it('小数除法继续使用普通竖式，但不会静默丢弃余数或长除法步骤', () => {
        expect(renderFigureSpec(raw({ type: 'vertical_arithmetic', operation: '÷', top: '3.4', bottom: '2.5' }))).not.toBeNull();
        expect(renderFigureSpec(raw({ type: 'vertical_arithmetic', operation: '÷', top: '3.4', bottom: '2.5', remainder: '?' }))).toBeNull();
        expect(renderFigureSpec(raw({ type: 'vertical_arithmetic', operation: '÷', top: '3.4', bottom: '2.5', divisionSteps: [
            { value: '3.4', subtract: '2.5', shift: 0 },
        ] }))).toBeNull();
    });

    it.each([
        { bottom: '0' }, { top: '-847' }, { bottom: '-7' }, { top: '84.7' }, { bottom: '0.7' },
        { result: '12.1' }, { remainder: '0.5' },
        { divisionSteps: [{ value: '8', subtract: '6', shift: 2 }, ...division.divisionSteps.slice(1)] },
        { divisionSteps: [{ value: '8', subtract: '7', shift: 2 }, { value: '15', subtract: '14', shift: 1 }, division.divisionSteps[2]] },
        { divisionSteps: [...division.divisionSteps].reverse() },
        { divisionSteps: [division.divisionSteps[0], division.divisionSteps[0]] },
        { divisionSteps: [division.divisionSteps[0], division.divisionSteps[2]] },
        { divisionSteps: [{ value: '8', subtract: '7', shift: 3 }] },
        { divisionSteps: [{ value: '8', subtract: '7' }] },
        { divisionSteps: [{ value: '8', subtract: '7', shift: 2, label: '甲'.repeat(20) }] },
        { partialProducts: [{ value: '7', shift: 2 }] },
    ])('矛盾或不支持的结构整图回退：%j', (patch) => {
        const value = raw({ ...division, ...patch });
        expect(renderFigureSpec(value)).toBeNull();
        expect(parseFigure('true', legacy, value)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, value)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('操作数未知时仍检查已知减法、除数倍数和带下一位关系', () => {
        const unknown = { ...division, top: '8□7', result: '1□1', remainder: '?', divisionSteps: division.divisionSteps };
        expect(renderFigureSpec(raw(unknown))).not.toBeNull();
        for (const patch of [
            { divisionSteps: [{ value: '8', subtract: '9', shift: 2 }] },
            { divisionSteps: [{ value: '8', subtract: '6', shift: 2 }] },
            { divisionSteps: [division.divisionSteps[0], { value: '24', subtract: '21', shift: 1 }, division.divisionSteps[2]] },
        ]) expect(renderFigureSpec(raw({ ...unknown, ...patch }))).toBeNull();
    });

    it('未知除数和已知负余数、超数位行仍拒绝，完整未知步骤可以保留', () => {
        expect(renderFigureSpec(raw({ ...division, top: '□□□', bottom: '□', result: '□□□', remainder: '?', divisionSteps: [
            { value: '□', subtract: '□', shift: 2 }, { value: '□□', subtract: '□□', shift: 1 }, { value: '□□', subtract: '□□', shift: 0 },
        ] }))).not.toBeNull();
        expect(renderFigureSpec(raw({ ...division, top: '□□□', bottom: '□', remainder: '-1' }))).toBeNull();
        expect(renderFigureSpec(raw({ ...division, top: '□□□', bottom: '□', divisionSteps: [{ value: '12345', subtract: '1', shift: 0 }] }))).toBeNull();
    });

    it('非除法不能携带除法步骤，任一选项冲突使整组回退', () => {
        expect(renderFigureSpec(raw({ ...division, operation: '×', remainder: undefined }))).toBeNull();
        const group = raw({ type: 'figure_group', figures: [
            { label: 'A', figure: division }, { label: 'B', figure: { ...division, bottom: '0' } },
        ] });
        expect(renderFigureSpecDetailed(group)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
        expect(parseFigure('true', legacy, group).figureSvg).toBe(legacy);
    });
});

import { describe, expect, it } from 'vitest';
import { ARITHMETIC_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-arithmetic-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { FIGURE_SPEC_RULES } from '@/lib/ai/prompts';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const multiplication = {
    type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '25',
    partialProducts: [{ value: '170', label: '甲' }, { value: '68', label: '乙' }], result: '850',
};
const raw = (value: unknown) => JSON.stringify(value);

describe('竖式中的作答空格和数位关系', () => {
    it.each(ARITHMETIC_FIGURE_FIXTURES.filter(({ initialVisible }) => initialVisible))('$id 初始手机阅读不被外围留白占满', ({ spec }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const root = new DOMParser().parseFromString(svg!, 'image/svg+xml').documentElement;
        expect(Number(root.getAttribute('width'))).toBeLessThanOrEqual(260);
        expect(Number(root.getAttribute('height'))).toBeLessThan(450);
    });

    it('每个数字和方框使用同一个数位间距，不靠字体字宽对齐', () => {
        const document = new DOMParser().parseFromString(renderFigureSpec(raw(ARITHMETIC_FIGURE_FIXTURES[0].spec))!, 'image/svg+xml');
        const top = document.querySelector('text[data-arithmetic-row="top"]')!;
        const partials = Array.from(document.querySelectorAll('text[data-arithmetic-row="partial"]'));
        expect(top).not.toBeNull();
        expect(partials).toHaveLength(2);
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/).map(Number);
        const unit = positions(top).at(-1)!;
        const step = positions(top)[1] - positions(top)[0];
        expect(step).toBeGreaterThanOrEqual(28);
        for (const element of [top, ...partials]) {
            const values = positions(element);
            expect(values).toHaveLength(element.textContent!.length);
            for (let index = 1; index < values.length; index += 1) expect(values[index] - values[index - 1]).toBe(step);
        }
        expect(positions(partials[0]).at(-1)).toBe(unit);
        expect(positions(partials[1]).at(-1)).toBe(unit - step);
    });

    it('多行竖式的说明在完整结果下方，不能固定在中间压住部分积', () => {
        const spec = {
            ...multiplication, top: '12345678', bottom: '87654321',
            partialProducts: Array.from({ length: 8 }, (_, shift) => ({ value: '1', label: `积${shift + 1}`, shift })),
            result: '1', note: '比较每一行部分积并说明数位关系',
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'));
        const note = texts.find((element) => element.textContent === spec.note)!;
        const result = texts.find((element) => element.textContent === '1082152022374638')!;
        expect(Number(note.getAttribute('y'))).toBeGreaterThan(Number(result.getAttribute('y')) + 24);
        expect(Number(document.documentElement.getAttribute('height'))).toBeLessThanOrEqual(800);
    });

    it('无法完整排版的长说明回退，不能压成小字或漏字', () => {
        const spec = raw({ ...multiplication, note: '1'.repeat(60) });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('数位与完整标签超出画布时不缩小字或截字，整图和整组均回退', () => {
        const figure = {
            type: 'vertical_arithmetic', operation: '×', top: 'a'.repeat(18), bottom: '25',
            partialProducts: [{ value: 'b'.repeat(18), label: '甲'.repeat(12), shift: 1 }],
        };
        const group = { type: 'figure_group', figures: [{ label: 'A', figure: multiplication }, { label: 'B', figure }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧配图</text></svg>';
        for (const spec of [figure, group]) {
            expect(parseFigureSpec(raw(spec))).not.toBeNull();
            expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
            expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it.each(ARITHMETIC_FIGURE_FIXTURES)('$id 保留完整题图和确定输出', ({ spec, mustContain, mustHaveText }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).toBe(svg);
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        for (const value of mustContain) expect(svg).toContain(value);
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        for (const value of mustHaveText ?? []) expect(texts).toContain(value);
    });

    it.each(['□', '□□□', '___', '?', '1□0', 'a70', '( )', '34 × 5'])(
        '已知两个因数也不把部分积中的 %s 改成答案', (value) => {
            const spec = { ...multiplication, partialProducts: [{ value, label: '甲' }, { value: '68', label: '乙' }] };
            expect(parseFigureSpec(raw(spec))).toMatchObject({
                partialProducts: [{ value, label: '甲', shift: 0 }, { value: '68', label: '乙', shift: 1 }],
            });
            expect(renderFigureSpec(raw(spec))).toContain(`>${value}</text>`);
        },
    );

    it.each(['×', '+', '-'])('%s 的结果空格不能被自动计算填满', (operation) => {
        const spec = { ...multiplication, operation, partialProducts: [], result: '□□□' };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ result: '□□□' });
        expect(renderFigureSpec(raw(spec))).toContain('>□□□</text>');
    });

    it('全角数字和问号规范化后仍保留作答状态，不补全缺少的结果', () => {
        const spec = { ...multiplication, top: '３４', bottom: '２５', partialProducts: [{ value: '？' }], result: '？' };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ top: '34', bottom: '25', partialProducts: [{ value: '?', shift: 0 }], result: '?' });
        const parsed = parseFigureSpec(raw({ ...spec, result: undefined }));
        expect(parsed).not.toHaveProperty('result');
    });

    it('未知被乘数也按每行默认数位错开，甲乙保持各自标签', () => {
        const spec = ARITHMETIC_FIGURE_FIXTURES[1].spec;
        expect(parseFigureSpec(raw(spec))).toMatchObject({ partialProducts: [{ shift: 0 }, { shift: 1 }] });
        const document = new DOMParser().parseFromString(renderFigureSpec(raw(spec))!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row="partial"]'));
        expect(rows.map((element) => element.textContent)).toEqual(['□□□', '□□']);
        const positions = rows.map((element) => element.getAttribute('x')!.split(/\s+/).map(Number));
        const step = positions[0][1] - positions[0][0];
        expect(positions[0].at(-1)! - positions[1].at(-1)!).toBe(step);
        const labels = Array.from(document.querySelectorAll('text')).filter((element) => ['甲', '乙'].includes(element.textContent ?? ''));
        expect(labels.map((element) => element.textContent)).toEqual(['甲', '乙']);
        expect(labels.map((element) => element.getAttribute('y'))).toEqual(rows.map((element) => element.getAttribute('y')));
    });

    it('部分积只有一行时仍尊重显式十位，不按行数重排', () => {
        const spec = { ...multiplication, top: '□□', partialProducts: [{ value: '□□', label: '乙', shift: 1 }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ partialProducts: [{ value: '□□', label: '乙', shift: 1 }] });
    });

    it.each([
        { partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 0 }], name: '重复数位' },
        { partialProducts: [{ value: '170', shift: 2 }], name: '超出乘数位数' },
        { partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }, { value: '1' }], name: '默认位移超出位数' },
    ])('$name 时不返回貌似有效的竖式，保留旧图或无图回退', ({ partialProducts }) => {
        const spec = raw({ ...multiplication, partialProducts });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>保留原配图</text></svg>';
        expect(parseFigure('true', legacy, spec)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('未知乘数不猜测位数或数字，但仍拒绝重复声明同一数位', () => {
        const spec = { ...multiplication, bottom: 'n', partialProducts: [{ value: 'a', shift: 0 }, { value: 'b', shift: 2 }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ bottom: 'n', partialProducts: spec.partialProducts });
        expect(parseFigureSpec(raw({ ...spec, partialProducts: [{ value: 'a', shift: 0 }, { value: 'b', shift: 0 }] }))).toBeNull();
    });

    it('任一子图数位错误时整组回退，不能漏掉有问题的选项', () => {
        const spec = raw({ type: 'figure_group', figures: [
            { label: 'A', figure: multiplication },
            { label: 'B', figure: { ...multiplication, partialProducts: [{ value: '1', shift: 8 }] } },
        ] });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation', type: 'figure_group' } });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('图组保留子图作答空格，不因嵌套重新计算答案', () => {
        const spec = raw({ type: 'figure_group', figures: ARITHMETIC_FIGURE_FIXTURES.slice(0, 2).map(({ spec }, index) => ({ label: 'AB'[index], figure: spec })) });
        const svg = renderFigureSpec(spec);
        expect(svg).not.toBeNull();
        expect(svg).toContain('>1□0</text>');
        expect(svg).not.toContain('>850</text>');
        expect(svg).not.toContain('>170</text>');
    });

    it.each([
        { operation: '×', expected: '850' }, { operation: '+', expected: '59' }, { operation: '-', expected: '9' },
    ])('保留 %s 已有纯整数结果的精确复算，不把空格保护扩大成禁用数值校验', ({ operation, expected }) => {
        expect(parseFigureSpec(raw({ ...multiplication, operation, partialProducts: [], result: '999' }))).toMatchObject({ result: expected });
    });

    it('大整数继续精确复算，不丢失超过安全整数范围的数字', () => {
        expect(parseFigureSpec(raw({ ...multiplication, top: '99999999999999999', bottom: '9', partialProducts: [], result: '1' })))
            .toMatchObject({ result: '899999999999999991' });
    });

    it('统一提示词要求保留空格，并明确每行乘法位移不能重复', () => {
        expect(FIGURE_SPEC_RULES).toContain('不得把作答空格替换为计算结果');
        expect(FIGURE_SPEC_RULES).toContain('不同部分积不能重复使用同一 shift');
    });
});

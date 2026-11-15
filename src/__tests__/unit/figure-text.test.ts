import { describe, expect, it } from 'vitest';
import { MATH_TEXT_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-math-text-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { renderFigureSpec } from '@/lib/figure-spec';
import { tokenizeFigureText } from '@/lib/figure-text-tokens';

const legacy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="20">完整旧图</text></svg>';

describe('数学标注分词', () => {
    it.each([
        '12.5 cm', '12 cm²', '12 cm2', '12 cm,', '12 cm.', '−0.75 m/s', '3 / 25', '2 3/4', '2 3 / 4',
        'x² + y²', 'x + 1', 'x + y', 'x - y', 'a-b', 'α + β', 'x (y + 1)', '2 (x + 1)', 'f(x) = 2x + 1',
        'x ≤ 12', 'A₁ = 12.5 cm', '3 × 10⁴', '3 ∶ 4', '(1, 2)', 'A (1, 2)', '( 1, 2 )',
        'xᵢ', 'xᵃ', '𝑥ᵢ', 'x^n', 'x/y', 'x:y', '2*3', 'x * y',
        '√2', '√ 2', '∛27', '12 平方厘米', '120 千米/小时', '120 千米 / 小时', '5 米/秒', '12 毫升', '30 °',
        '12  cm', '12 \t cm', '3  /  25', '2  3 / 4', 'x  +  y', '(  1,  2  )', '120  千米 / 小时', '30\u00a0\u00a0°',
    ])('%s 完整保留为同一个数学标记', (token) => {
        expect(tokenizeFigureText(`已知${token}时`)).toEqual(['已', '知', token, '时']);
    });

    it.each([
        '$\\frac{1}{2}$', '$$\\dfrac{12}{25}$$', '\\(\\sqrt[3]{27}\\)', '\\[\\left(x + 1\\right)\\]',
        '$\\angle ABC$', '$\\triangle ABC$', '$\\overline{AB}$', '$\\text{厘米}$', '$\\frac{\\sqrt{3}}{2}$',
    ])('成对定界的 LaTeX 文本不可被分词拆开：%s', (formula) => {
        expect(tokenizeFigureText(`已知${formula}时`)).toEqual(['已', '知', formula, '时']);
    });

    it.each(['\\frac{1}{2}', '\\dfrac{12}{25}', '\\sqrt[3]{27}', '\\mathrm{cm}^2'])('连续原始 LaTeX 命令保持完整：%s', (formula) => {
        expect(tokenizeFigureText(`已知${formula}时`)).toEqual(['已', '知', formula, '时']);
    });

    it('未闭合公式不把后续普通说明吞成一个数学标记', () => {
        const value = '已知 $\\frac{1}{2} 后继续说明';
        const tokens = tokenizeFigureText(value);
        expect(tokens.join('')).toBe(value);
        expect(tokens.length).toBeGreaterThan(4);
    });

    it.each(['葛\u{e0100}', '汉\ufe00', 'x\u20d7', 'e\u0301'])('完整字形 %s 不能拆开', (cluster) => {
        const tokens = tokenizeFigureText(`甲${cluster}乙`);
        expect(tokens).toEqual(['甲', cluster, '乙']);
        expect(tokens.join('')).toBe(`甲${cluster}乙`);
    });

    it.each(['Length is 12 cm and width is 4 mm.', 'first-term second-term', '甲 A B 乙', '12 34', '中文说明需要正常换行', 'x\t+\t1'])('分词不改写原文，也不把普通说明整体锁死：%s', (value) => {
        const tokens = tokenizeFigureText(value);
        expect(tokens.join('')).toBe(value);
        if (!value.includes('\t')) expect(tokens.length).toBeGreaterThan(1);
    });
    it('相邻两个数不会因为空格被误认为一个数', () => {
        expect(tokenizeFigureText('12 34')).toEqual(['12', ' ', '34']);
        expect(tokenizeFigureText('12  34')).toEqual(['12', ' ', ' ', '34']);
        expect(tokenizeFigureText('12 cm and 4 mm')).toEqual(['12 cm', ' ', 'a', 'n', 'd', ' ', '4 mm']);
        expect(tokenizeFigureText('first-term')).toEqual(Array.from('first-term'));
    });
});

describe('组合字形的标注尺寸', () => {
    it.each([
        ['combining marks', 'e\u0301'.repeat(16)],
        ['variation selectors', '汉\ufe00'.repeat(8)],
    ])('%s count as one displayed grapheme in title sizing', (_kind, title) => {
        const normalized = title.normalize('NFC');
        const renderTitle = (value: string) => {
            const svg = renderFigureSpec(JSON.stringify({ type: 'area_geometry', shape: 'square', width: 5, height: 5, title: value }));
            expect(svg).not.toBeNull();
            return new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelector('text[data-figure-title="true"]')!;
        };
        const originalTitle = renderTitle(title);
        const normalizedTitle = renderTitle(normalized);
        expect(originalTitle.textContent?.normalize('NFC')).toBe(normalizedTitle.textContent?.normalize('NFC'));
        expect(originalTitle.querySelectorAll('tspan').length).toBe(normalizedTitle.querySelectorAll('tspan').length);
        expect(originalTitle.querySelectorAll('tspan')).toHaveLength(0);
    });
});

describe('数学标注分行保真', () => {
    it.each(MATH_TEXT_FIGURE_FIXTURES)('$id 保留完整说明，并让每个数学标记保持同一行', ({ spec, mustHaveText, unbrokenText }) => {
        const svg = renderFigureSpec(JSON.stringify(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'));
        for (const value of mustHaveText ?? []) expect(texts.some((text) => text.textContent === value)).toBe(true);
        for (const token of unbrokenText ?? []) expect(texts.some((text) => {
            const lines = text.querySelectorAll('tspan');
            return lines.length ? Array.from(lines).some((line) => line.textContent?.includes(token)) : text.textContent?.includes(token);
        })).toBe(true);
    });
    it.each(['12.5 cm', '3 / 25', 'x² + y²', 'x + 1', '−0.75 m/s', '3 × 10⁴', '120 千米/小时'])('方格内的 %s 不被空格或单位拆开', (token) => {
        const label = `数值为${token}时`;
        const svg = renderFigureSpec(JSON.stringify({ type: 'grid_shape', rows: 5, cols: 5, cellLabels: [{ row: 2, col: 3, text: label }] }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const text = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === label)!;
        const lines = text.querySelectorAll('tspan');
        expect(lines.length).toBeGreaterThan(1);
        expect(Array.from(lines, (line) => line.textContent).some((line) => line?.includes(token))).toBe(true);
    });

    it('窄表格中根号与被开方数不能拆开', () => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'table', headers: Array.from({ length: 12 }, (_, index) => `列${index + 1}`), rows: [['为a√2时']] }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const text = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === '为a√2时')!;
        expect(Array.from(text.querySelectorAll('tspan'), (line) => line.textContent).some((line) => line?.includes('√2'))).toBe(true);
    });

    it('窄表格中短公式完整换行，宽公式触发旧图回退而不拆开', () => {
        const headers = Array.from({ length: 12 }, (_, index) => `列${index + 1}`);
        const shortLabel = '已知$x$时';
        const shortSpec = { type: 'table', headers, rows: [[shortLabel]] };
        const shortSvg = renderFigureSpec(JSON.stringify(shortSpec));
        expect(shortSvg).not.toBeNull();
        const document = new DOMParser().parseFromString(shortSvg!, 'image/svg+xml');
        const text = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === shortLabel)!;
        expect(Array.from(text.querySelectorAll('tspan'), (line) => line.textContent).some((line) => line?.includes('$x$'))).toBe(true);

        const longLabel = '已知$\\frac{1}{2}$时';
        const longSpec = JSON.stringify({ type: 'table', headers, rows: [[longLabel]] });
        expect(renderFigureSpec(longSpec)).toBeNull();
        expect(parseFigure('true', legacy, longSpec).figureSvg).toBe(legacy);
        expect(parseFigure('true', null, longSpec).figureSvg).toBeNull();
    });

    it('6×6 方格保留原始组合反例，完整速度单位超过当前字号与边距限制时回退', () => {
        const raw = JSON.stringify({ ...MATH_TEXT_FIGURE_FIXTURES[0].spec, rows: 6, cols: 6 });
        expect(renderFigureSpec(raw)).toBeNull();
        expect(parseFigure('true', legacy, raw).figureSvg).toBe(legacy);
    });

    it.each([
        { type: 'grid_shape', rows: 30, cols: 30, cellLabels: [{ row: 0, col: 0, text: '12.5 cm' }] },
        { type: 'table', headers: Array.from({ length: 12 }, (_, index) => `列${index + 1}`), rows: [['12345 cm']] },
        { type: 'bar_chart', categories: Array<string>(12).fill('123 cm'), values: Array<number>(12).fill(1) },
    ])('$type 容纳不了完整数值单位时整图回退', (spec) => {
        const raw = JSON.stringify(spec);
        expect(renderFigureSpec(raw)).toBeNull();
        expect(parseFigure('true', legacy, raw).figureSvg).toBe(legacy);
        expect(parseFigure('true', null, raw).figureSvg).toBeNull();
        expect(renderFigureSpec(JSON.stringify({ type: 'figure_group', figures: [
            { label: 'A', figure: { type: 'fraction', numerator: '1', denominator: '2' } }, { label: 'B', figure: spec },
        ] }))).toBeNull();
    });
});

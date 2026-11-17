import { describe, expect, it } from 'vitest';
import { MIXED_FRACTION_FIXTURES, mixedFractionSpec } from '@/__tests__/fixtures/figure-fraction-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { FIGURE_SPEC_RULES } from '@/lib/ai/prompts';
import { parseFigureSpec, renderFigureSpec } from '@/lib/figure-spec';

const legacy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="20">完整旧图</text></svg>';

describe('带分数图示', () => {
    it('共享提示词要求保留整数部分并明确图示容量与回退', () => {
        expect(FIGURE_SPEC_RULES).toContain('带分数必须保留 whole');
        expect(FIGURE_SPEC_RULES).toContain('0~5 的明确非负整数');
        expect(FIGURE_SPEC_RULES).toContain('完整旧 SVG/原图回退');
    });
    it.each(['bar', 'circle'])('%s 完整保留整数单位与剩余分数', (model) => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'fraction', whole: '2', numerator: '3', denominator: '4', model, parts: 4, filled: 3,
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        expect(texts).toContain('2 3/4');
        expect(texts.filter((text) => text === '1')).toHaveLength(2);
        expect(texts).toContain('3/4');
    });

    it.each(MIXED_FRACTION_FIXTURES)('$id 的图形数量、分割、完整涂色与总量一致', (fixture) => {
        const spec = mixedFractionSpec(fixture);
        const svg = renderFigureSpec(JSON.stringify(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const shapes = Array.from(document.querySelectorAll(fixture.model === 'bar' ? 'rect[fill="none"]' : 'circle[fill="none"]'));
        expect(shapes).toHaveLength(fixture.whole + 1);
        const size = (element: Element) => fixture.model === 'bar'
            ? [element.getAttribute('width'), element.getAttribute('height')] : [element.getAttribute('r')];
        for (const shape of shapes) expect(size(shape)).toEqual(size(shapes[0]));
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        expect(texts.filter((text) => text === '1')).toHaveLength(fixture.whole);
        expect(texts).toContain(`${fixture.whole} ${fixture.filled}/${fixture.parts}`);
        expect(texts).toContain(spec.label);
        expect(document.querySelectorAll('line')).toHaveLength((fixture.whole + 1) * (fixture.model === 'circle' && fixture.parts > 1 ? fixture.parts : fixture.parts - 1));
        if (fixture.model === 'bar') {
            const fills = Array.from(document.querySelectorAll('rect[fill="#dbeafe"]'));
            expect(fills).toHaveLength(fixture.whole + (fixture.filled > 0 ? 1 : 0));
            const totalWidth = Number(shapes[0].getAttribute('width'));
            expect(fills.reduce((sum, fill) => sum + Number(fill.getAttribute('width')) / totalWidth, 0)).toBeCloseTo(fixture.whole + fixture.filled / fixture.parts, 10);
        } else {
            expect(document.querySelectorAll('circle[fill="#dbeafe"]')).toHaveLength(fixture.whole + (fixture.filled === fixture.parts ? 1 : 0));
            expect(document.querySelectorAll('path[fill="#dbeafe"]')).toHaveLength(fixture.filled > 0 && fixture.filled < fixture.parts ? 1 : 0);
        }
        expect(parseFigure('true', legacy, JSON.stringify(spec)).figureSvg).toBe(svg);
    });

    it.each(['bar', 'circle'])('%s 的全角整数归一化后仍保留全部单位', (model) => {
        const raw = JSON.stringify({ type: 'fraction', model, whole: ' ２ ', numerator: ' ３ ', denominator: ' ４ ', parts: 4, filled: 3 });
        expect(parseFigureSpec(raw)).toMatchObject({ whole: '2', numerator: '3', denominator: '4' });
        expect(renderFigureSpec(raw)).toContain('>2 3/4</text>');
    });

    for (const model of ['bar', 'circle']) {
        it.each(['-1', '-0', '6', '100000000000', '1.5', 'a', '□', '2/3', '−2'])(`${model} 不明确或超出容量的整数部分 %s 整图回退`, (whole) => {
            const spec = { type: 'fraction', model, whole, numerator: '3', denominator: '4', parts: 4, filled: 3 };
            const raw = JSON.stringify(spec);
            expect(parseFigureSpec(raw)).toBeNull();
            expect(renderFigureSpec(raw)).toBeNull();
            expect(parseFigure('true', legacy, raw)).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw)).toEqual({ hasFigure: true, figureSvg: null });
            expect(renderFigureSpec(JSON.stringify({ type: 'figure_group', figures: [
                { label: 'A', figure: { ...spec, whole: '1' } }, { label: 'B', figure: spec },
            ] }))).toBeNull();
        });
    }

    it('普通上下分数继续保留符号整数，不把图示容量限制套到文字公式', () => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'fraction', whole: 'a', numerator: 'x+1', denominator: 'y', model: 'fraction' }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(Array.from(document.querySelectorAll('text'), (element) => element.textContent)).toEqual(['a', 'x+1', 'y']);
    });

    it('代数分数横线覆盖完整表达式，普通短分数保持原宽度', () => {
        const renderBarWidth = (numerator: string, denominator: string, whole?: string) => {
            const svg = renderFigureSpec(JSON.stringify({ type: 'fraction', numerator, denominator, whole, model: 'fraction' }));
            expect(svg).not.toBeNull();
            const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
            const bar = document.querySelector('line')!;
            const x1 = Number(bar.getAttribute('x1'));
            const x2 = Number(bar.getAttribute('x2'));
            expect(x1 + x2).toBeCloseTo(whole ? 860 : 800, 10);
            return x2 - x1;
        };

        expect(renderBarWidth('3', '4')).toBe(110);
        expect(renderBarWidth('x+10000000000', 'y+1')).toBeGreaterThan(110);
        expect(renderBarWidth('x+10000000000', 'y+1', '2')).toBeLessThanOrEqual(166);
    });

    it('有效带分数可参与图组，无效子图不会只留下其它选项', () => {
        const raw = JSON.stringify({ type: 'figure_group', figures: MIXED_FRACTION_FIXTURES.slice(0, 2).map((fixture, index) => ({ label: 'AB'[index], figure: mixedFractionSpec(fixture) })) });
        const svg = renderFigureSpec(raw);
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelectorAll('g[data-figure-panel]')).toHaveLength(2);
        for (const panel of document.querySelectorAll('g[data-figure-panel]')) expect(panel.textContent).toContain('2 3/4');
    });

    it.each(['bar', 'circle'])('%s 的剩余分数字符无法完整容纳时回退，不输出局部图形', (model) => {
        const raw = JSON.stringify({ type: 'fraction', model, whole: '5', numerator: '未'.repeat(18), denominator: '4', parts: 4, filled: 3 });
        expect(parseFigureSpec(raw)).toBeNull();
        expect(renderFigureSpec(raw)).toBeNull();
        expect(parseFigure('true', legacy, raw).figureSvg).toBe(legacy);
    });
});

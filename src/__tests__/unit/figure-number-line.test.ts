import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const base = { type: 'number_line', min: 0, max: 10, step: 1 };
const raw = (spec: unknown) => JSON.stringify(spec);
const documentOf = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('数轴点名的避让与对应关系', () => {
    it('相邻长点名共同选位，完整保留点名和准确点位', () => {
        const spec = { ...base, points: [{ value: 4.5, label: 'A₁' }, { value: 4.8, label: 'B₁' }] };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = documentOf(svg!);
        const labels = Array.from(document.querySelectorAll('text[data-figure-label="point"]'));
        expect(labels.map((label) => label.textContent)).toEqual(['A₁', 'B₁']);
        for (const [index, x] of [369, 387.6].entries()) {
            expect(Number(labels[index].getAttribute('data-point-x'))).toBeCloseTo(x, 8);
            expect(Number(labels[index].getAttribute('data-point-y'))).toBe(250);
            const marker = document.querySelectorAll('circle')[index];
            expect(Number(marker.getAttribute('cx'))).toBeCloseTo(x, 8);
            expect(Number(marker.getAttribute('cy'))).toBe(250);
        }
        const positions = labels.map((label) => [Number(label.getAttribute('x')), Number(label.getAttribute('y'))]);
        expect(positions).not.toEqual([[369, 228], [387.6, 228]]);
        expect(renderFigureSpec(raw(spec))).toBe(svg);
    });

    it('没有点名的标记仍参与点名归属检查，位置和颜色保持不变', () => {
        const spec = { ...base, points: [{ value: 5, label: 'A', color: 'blue' }, { value: 5.2, color: 'red' }] };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = documentOf(svg!);
        const markers = Array.from(document.querySelectorAll('circle'));
        for (const [index, x] of [400, 412.4].entries()) expect(Number(markers[index].getAttribute('cx'))).toBeCloseTo(x, 8);
        expect(markers[0].getAttribute('fill')).not.toBe(markers[1].getAttribute('fill'));
        const label = document.querySelector('text[data-figure-label="point"]');
        expect(label?.textContent).toBe('A');
        expect(label?.getAttribute('data-point-x')).toBe('400');
    });

    it('点名和刻度都保留在紧凑画布内，不移动坐标或拉伸数轴', () => {
        const svg = renderFigureSpec(raw({ ...base, points: [{ value: 0, label: 'A' }, { value: 10, label: 'B' }] }));
        expect(svg).not.toBeNull();
        const document = documentOf(svg!);
        const [, top, width, height] = document.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(top).toBeGreaterThan(0);
        expect(width).toBeLessThan(800);
        expect(height).toBeLessThan(200);
        expect(document.querySelector('g[transform]')).toBeNull();
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        for (const expected of ['A', 'B', ...Array.from({ length: 11 }, (_, index) => String(index))]) expect(texts).toContain(expected);
        expect(Array.from(document.querySelectorAll('circle'), (point) => Number(point.getAttribute('cx')))).toEqual([90, 710]);
    });

    it.each(['A', 'A1', 'A₁', 'A′'])('同一数轴的不同位置不能同时显示点名 %s', (label) => {
        const spec = { ...base, points: [{ value: 2, label }, { value: 8, label }] };
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it('规范化全角点名后也检查重名，保留大小写和下标的区别', () => {
        expect(parseFigureSpec(raw({ ...base, points: [{ value: 2, label: ' Ａ ' }, { value: 8, label: 'A' }] }))).toBeNull();
        const spec = { ...base, points: [{ value: 2, label: 'a' }, { value: 5, label: 'A' }, { value: 8, label: 'A₁' }] };
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });

    it('同位置的不同点名可以共同标注，不擅自合并、移动或改名', () => {
        const svg = renderFigureSpec(raw({ ...base, points: [{ value: 5, label: 'A' }, { value: 5, label: 'B' }] }));
        expect(svg).not.toBeNull();
        const document = documentOf(svg!);
        expect(Array.from(document.querySelectorAll('text[data-figure-label="point"]'), (label) => label.textContent)).toEqual(['A', 'B']);
        expect(Array.from(document.querySelectorAll('circle'), (point) => Number(point.getAttribute('cx')))).toEqual([400, 400]);
    });

    it('无法排版或点名冲突时整图／整组走完整旧 SVG 兜底', () => {
        const spec = { ...base, points: [{ value: 2, label: 'A' }, { value: 8, label: 'A' }] };
        const group = { type: 'figure_group', figures: [{ label: '甲', figure: spec }, { label: '乙', figure: base }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧数轴</text></svg>';
        for (const input of [spec, group, { ...base, points: [{ value: 5, label: '无法在点名区域完整排版的过长说明文字' }] }]) {
            expect(parseFigure('true', legacy, raw(input))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(input))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it.each([
        '数轴上点A表示的数是-2。', '点A在数轴上对应的数为-2。', '点A所表示的数等于−2。',
        '点 A 对应数值是 - 2。', 'The number represented by point A is -2.',
        'Point A represents -2 on the number line.',
    ])('明确点值声明与图上数值冲突时回退：%s', (question) => {
        const spec = { ...base, points: [{ value: 3, label: 'A' }] };
        expect(parseFigureSpec(raw(spec), question)).toBeNull();
    });

    it.each([
        ['点A表示的数是-2。', -2], ['点A表示数-2。', -2], ['点A对应-2。', -2],
        ['点A对应数值为0.3000。', 0.3],
        ['点A表示的数是0.0000001。', 1e-7], ['点A表示的数是\\(-2\\)。', -2],
        ['Point A represents .3.', 0.3],
    ])('数值一致时保留数轴：%s', (question, value) => {
        const spec = { ...base, min: -10, points: [{ value, label: 'A' }] };
        expect(parseFigureSpec(raw(spec), question)).not.toBeNull();
    });

    it('不把候选、疑问、假设、引用或多个数值选项作为已知点值', () => {
        const spec = raw({ ...base, points: [{ value: 3, label: 'A' }] });
        for (const question of [
            '下列说法中，点A表示的数是-2，哪一个正确？',
            '点A表示的数是-2吗？', '如果点A表示的数是-2，求点B。',
            '“点A表示的数是-2”。', '点A表示的数是-2或3。', '点A表示的数是3，还是4。',
            '点A原来表示的数是-2，移动后对应3。', 'Point A represented -2 before translation and 3 after.',
        ]) expect(parseFigureSpec(spec, question), question).not.toBeNull();
    });

    it('使用精确十进制比较，不把微小差异当作相同数值', () => {
        const spec = raw({ ...base, min: -10, points: [{ value: 0.3, label: 'A' }] });
        expect(parseFigureSpec(spec, '点A表示的数是0.30000000000000001。')).toBeNull();
    });

    it('只校验可见同名点；显式分段图组内点名缺失时整组回退', () => {
        const missingSinglePoint = raw({ ...base, points: [{ value: 3, label: 'B' }] });
        expect(parseFigureSpec(missingSinglePoint, '点A表示的数是-2。')).not.toBeNull();

        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: { ...base, points: [{ value: 3, label: 'B' }] } },
            { label: '乙', figure: { ...base, points: [{ value: 4, label: 'A' }] } },
        ] };
        expect(parseFigureSpec(raw(group), '图甲中：点A表示的数是-2；图乙中：点A表示的数是4。')).toBeNull();
    });

    it('数值冲突保留完整旧 SVG，并且不修改原始结构', () => {
        const spec = { ...base, points: [{ value: 3, label: 'A' }] };
        const source = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原数轴</text></svg>';
        expect(parseFigure('true', legacy, source, '点A表示的数是-2。'))
            .toEqual({ hasFigure: true, figureSvg: legacy });
        expect(raw(spec)).toBe(source);
    });
});

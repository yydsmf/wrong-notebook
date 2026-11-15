import { describe, expect, it } from 'vitest';
import { circleOption, FIGURE_GROUP_FIXTURES } from '@/__tests__/fixtures/figure-group-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { layoutFigureGroup } from '@/lib/figure-group-layout';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const pair = (figure: Record<string, unknown>) => ({ type: 'figure_group', figures: [{ label: 'A', figure: circleOption(10) }, { label: 'B', figure }] });

describe('结构化图组', () => {
    it.each(FIGURE_GROUP_FIXTURES)('$id 保留顺序、标签和每张子图的独立画布', ({ spec }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).toBe(svg);
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        const panels = Array.from(document.querySelectorAll('g[data-figure-panel]'));
        expect(panels.map((panel) => panel.getAttribute('data-figure-option'))).toEqual(spec.figures.map((entry) => entry.label));
        const scales: number[] = [];
        panels.forEach((panel, index) => {
            const child = panel.querySelector('svg')!;
            const viewBox = child.getAttribute('viewBox')!.split(/\s+/).map(Number);
            const width = Number(child.getAttribute('width'));
            const height = Number(child.getAttribute('height'));
            scales.push(width / viewBox[2]);
            expect(width / viewBox[2]).toBeCloseTo(height / viewBox[3], 10);
            expect(panel.querySelector('text')!.textContent).toBe(spec.figures[index].label);
            const single = new DOMParser().parseFromString(renderFigureSpec(raw(spec.figures[index].figure))!, 'image/svg+xml');
            expect(child.innerHTML).toBe(single.documentElement.innerHTML);
            expect(child.getAttribute('viewBox')).toBe(single.documentElement.getAttribute('viewBox'));
        });
        scales.forEach((scale) => expect(scale).toBeCloseTo(scales[0], 10));
    });

    it('圆半径按同一比例显示，不把不同大小的选项放成一样大', () => {
        const svg = renderFigureSpec(raw(FIGURE_GROUP_FIXTURES[0].spec))!;
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const radii = Array.from(document.querySelectorAll('g[data-figure-panel]'), (panel) => {
            const child = panel.querySelector('svg')!;
            const viewWidth = Number(child.getAttribute('viewBox')!.split(/\s+/)[2]);
            const circle = Array.from(child.querySelectorAll('circle')).find((element) => Number(element.getAttribute('r')) > 7)!;
            return Number(circle.getAttribute('r')) * Number(child.getAttribute('width')) / viewWidth;
        });
        expect(radii).toHaveLength(4);
        radii.forEach((radius, index) => expect(radius / radii[0]).toBeCloseTo([1, 1.5, 2, 2.5][index], 10));
    });

    it('各选项可以重复使用顶点 ID，但不能引用其它选项的点', () => {
        const spec = pair({ type: 'basic_geometry', points: [{ id: 'P', x: 30, y: 30 }], segments: [{ from: 'P', to: 'O' }] });
        expect(parseFigureSpec(raw(spec))).toBeNull();
    });

    it('全角和空白统一后检测重复标签，保留有效标签与标题的原顺序', () => {
        const spec = pair(circleOption(20));
        spec.figures[0].label = ' Ａ ';
        const parsed = parseFigureSpec(raw(spec));
        expect(parsed?.type).toBe('figure_group');
        if (parsed?.type !== 'figure_group') throw new Error('图组未成功解析');
        expect(parsed.figures.map((entry) => entry.label)).toEqual(['A', 'B']);
        spec.figures[1].label = 'a';
        expect(parseFigureSpec(raw(spec))).toBeNull();
        spec.figures[1].label = ' ';
        expect(parseFigureSpec(raw(spec))).toBeNull();
    });

    it.each([1, 7])('拒绝 %i 张子图，不显示不完整的组', (count) => {
        const spec = { type: 'figure_group', figures: Array.from({ length: count }, (_, index) => ({ label: String(index), figure: circleOption(10) })) };
        expect(renderFigureSpec(raw(spec))).toBeNull();
    });

    it('拒绝递归图组', () => {
        expect(renderFigureSpec(raw(pair(pair(circleOption(20)))))).toBeNull();
    });

    it.each([
        { type: 'fraction', numerator: '1', denominator: '0' },
        { type: 'number_line', min: 0, max: 3, points: [{ value: 8 }] },
        { type: 'basic_geometry', points: [{ id: 'P', x: 20, y: 20 }], circles: [{ center: 'missing', radius: 10 }] },
        { type: 'grid_shape', rows: 30, cols: 30, cellLabels: [{ row: 0, col: 0, text: '第一季度数学成绩' }] },
    ])('任一子图不合法或无法排版时整组失败：$type', (figure) => {
        expect(renderFigureSpec(raw(pair(figure)))).toBeNull();
    });

    it('子图沿用单图边界校验，不因图组较高放宽', () => {
        const overflow = { type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 95 }], circles: [{ center: 'O', radius: 20 }] };
        expect(renderFigureSpecDetailed(raw(overflow)).diagnostic.reason).toBe('semantic_validation');
        expect(renderFigureSpec(raw(pair(overflow)))).toBeNull();
    });

    it.each([
        { type: 'area_geometry', shape: 'square', width: 10, height: 10 },
        { type: 'solid_geometry', shape: 'cube', width: 10, depth: 10, height: 10 },
        { type: 'coordinate_plane', xMin: 0, xMax: 4, yMin: 0, yMax: 4 },
        circleOption(0.5),
    ])('比较实际大小时拒绝独立适配或被模板限幅的尺寸：$type', (figure) => {
        expect(renderFigureSpecDetailed(raw({ ...pair(figure), compareSizes: true })).diagnostic.reason).toBe('semantic_validation');
    });

    it('转义选项标签，不能注入 SVG 属性或图元', () => {
        const spec = pair(circleOption(20));
        spec.figures[0].label = '\"><image/>';
        const svg = renderFigureSpec(raw(spec))!;
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(document.querySelector('image')).toBeNull();
        expect(document.querySelector('g')!.getAttribute('data-figure-option')).toBe('\"><image/>');
    });

    it.each(FIGURE_GROUP_FIXTURES.filter(({ id }) => id.startsWith('long-group-')))('$id 换行保留完整标题和数学标记，不改变子图内容与统一比例', ({ spec, unbrokenText }) => {
        const document = new DOMParser().parseFromString(renderFigureSpec(raw(spec))!, 'image/svg+xml');
        const plain = new DOMParser().parseFromString(renderFigureSpec(raw({ ...spec, title: undefined }))!, 'image/svg+xml');
        const heading = Array.from(document.documentElement.children).find((child) => child.tagName === 'text')!;
        expect(heading).toBeDefined();
        const parsed = parseFigureSpec(raw(spec));
        if (parsed?.type !== 'figure_group') throw new Error('图组标题未正确解析');
        expect(heading.textContent).toBe(parsed.title);
        expect(Number(heading.getAttribute('font-size'))).toBe(22);
        const lines = Array.from(heading.querySelectorAll('tspan'), (line) => line.textContent ?? '');
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const token of unbrokenText ?? []) expect(lines.some((line) => line.includes(token))).toBe(true);
        const panels = Array.from(document.querySelectorAll('g[data-figure-panel] > svg'));
        const plainPanels = Array.from(plain.querySelectorAll('g[data-figure-panel] > svg'));
        panels.forEach((panel, index) => {
            expect(panel.innerHTML).toBe(plainPanels[index].innerHTML);
            for (const attribute of ['viewBox', 'x', 'width', 'height']) expect(panel.getAttribute(attribute)).toBe(plainPanels[index].getAttribute(attribute));
        });
    });

    it.each(['1234567890'.repeat(6), '1234567890'.repeat(5) + '立方厘米', 'W1'.repeat(30)])('完整数值或单位放不下时整组回退，仍可使用旧 SVG：%s', (title) => {
        const spec = raw({ ...pair(circleOption(20)), title });
        expect(parseFigureSpec(spec)).not.toBeNull();
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        expect(parseFigure('true', undefined, spec).figureSvg).toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>';
        expect(parseFigure('true', legacy, spec).figureSvg).toContain('<circle');
    });

    it('完整长数值与单位能放下时保留单行，不一概拒绝数值标题', () => {
        const title = '1234567890'.repeat(5) + 'cm²';
        const svg = renderFigureSpec(raw({ ...pair(circleOption(20)), title }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const heading = Array.from(document.documentElement.children).find((child) => child.tagName === 'text')!;
        expect(heading.textContent).toBe(title);
        expect(heading.querySelector('tspan')).toBeNull();
        expect(Number(heading.getAttribute('font-size'))).toBe(22);
    });
});

describe('图组排版边界', () => {
    it('两列会使字号过小时改成单列，子图仍保持统一比例', () => {
        const layout = layoutFigureGroup([{ width: 800, height: 500, minimumFontSize: 18 }, { width: 300, height: 300, minimumFontSize: 20 }], 44)!;
        expect(layout).not.toBeNull();
        expect(layout.scale).toBe(0.94);
        expect(layout.panels[1].y).toBeGreaterThan(layout.panels[0].y + layout.panels[0].height);
    });

    it('无法满足最小字号或最大画布时回退，不无限加长或缩小', () => {
        expect(layoutFigureGroup(Array.from({ length: 6 }, () => ({ width: 800, height: 800, minimumFontSize: 18 })), 0)).toBeNull();
        expect(layoutFigureGroup(Array.from({ length: 2 }, () => ({ width: 800, height: 500, minimumFontSize: 11 })), 0)).toBeNull();
    });

    it.each([NaN, Infinity, -1, 0, 801])('拒绝无效子图尺寸 %s', (width) => {
        expect(layoutFigureGroup([{ width, height: 500 }, { width: 400, height: 500 }], 0)).toBeNull();
    });

    it.each([44, 73.7, 103.4])('标题区高度 %s 计入所有子图位置及整组高度', (titleHeight) => {
        const sizes = [{ width: 300, height: 180, minimumFontSize: 20 }, { width: 400, height: 200, minimumFontSize: 20 }];
        const withTitle = layoutFigureGroup(sizes, titleHeight)!;
        const plain = layoutFigureGroup(sizes, 0)!;
        expect(withTitle.scale).toBe(plain.scale);
        expect(withTitle.height).toBe(Math.ceil(plain.height + titleHeight));
        withTitle.panels.forEach((panel, index) => {
            expect(panel.y).toBeCloseTo(plain.panels[index].y + titleHeight, 10);
            expect(panel.labelY).toBeCloseTo(plain.panels[index].labelY + titleHeight, 10);
            for (const attribute of ['x', 'width', 'height', 'labelX'] as const) expect(panel[attribute]).toBe(plain.panels[index][attribute]);
        });
    });

    it('完整标题新增的高度超限时整组回退，不遗漏最后一张图', () => {
        const sizes = Array.from({ length: 3 }, () => ({ width: 800, height: 550, minimumFontSize: 20 }));
        expect(layoutFigureGroup(sizes, 44)).not.toBeNull();
        expect(layoutFigureGroup(sizes, 73.7)).toBeNull();
    });

    it.each([NaN, Infinity, -1])('拒绝无效标题区高度 %s', (titleHeight) => {
        expect(layoutFigureGroup([{ width: 300, height: 180 }, { width: 400, height: 200 }], titleHeight)).toBeNull();
    });
});

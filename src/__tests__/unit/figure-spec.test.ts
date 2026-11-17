import { describe, expect, it } from 'vitest';
import { STRUCTURED_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-spec-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

describe('structured figure specs', () => {
    it.each([
        { id: 'primary-triangle-side-lengths', points: [[283, 367], [517, 367], [400, 211]] },
        { id: 'junior-circle-name-overlap', points: [[361, 250], [439, 250]] },
        { id: 'junior-title-coordinate', points: [[302.5, 445], [351.25, 445], [302.5, 396.25]] },
    ])('收紧 $id 的画布，但保持题图坐标、标注内容及比例', ({ id, points }) => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((entry) => entry.id === id)!;
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const root = document.documentElement;
        const [x, y, width, height] = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
        expect(width).toBeLessThan(400);
        expect(height).toBeLessThan(500);
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(Number(root.getAttribute('width'))).toBe(width);
        expect(Number(root.getAttribute('height'))).toBe(height);
        expect(root.querySelector('rect')?.getAttribute('x')).toBe(String(x));
        expect(root.querySelector('rect')?.getAttribute('y')).toBe(String(y));
        expect(Array.from(root.querySelectorAll('circle')).filter((element) => Number(element.getAttribute('r')) <= 7)
            .map((element) => ['cx', 'cy'].map((attribute) => Number(element.getAttribute(attribute))))).toEqual(points);
        expect(root.querySelector('g[transform]')).toBeNull();
        expect(svg).toBe(renderFigureSpec(JSON.stringify(fixture.spec)));
    });

    it.each(STRUCTURED_FIGURE_FIXTURES)('renders the $stage fixture $id with stable SVG output', (fixture) => {
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));

        expect(svg).not.toBeNull();
        expect(svg!).toContain('<svg');
        expect(svg!).not.toMatch(/NaN|Infinity|undefined/);
        expect(renderFigureSpec(JSON.stringify(fixture.spec))).toBe(svg);
        for (const expectedText of fixture.mustContain) {
            expect(svg!).toContain(expectedText);
        }
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        if (['basic_geometry', 'circle_geometry', 'coordinate_plane'].includes(fixture.type)) {
            const spec = parseFigureSpec(JSON.stringify(fixture.spec));
            if (spec?.type === 'basic_geometry' || spec?.type === 'circle_geometry' || spec?.type === 'coordinate_plane') {
                const labels = [...spec.points, ...(spec.type === 'circle_geometry' ? [spec.center] : [])].flatMap((point) => point.label ? [point.label] : []);
                const renderedLabels = Array.from(document.querySelectorAll('text[data-figure-label="point"]'), (element) => element.textContent);
                expect(renderedLabels.slice().sort()).toEqual(labels.sort());
                const segmentLabels = (spec.type === 'circle_geometry'
                    ? [...spec.diameters, ...spec.chords, ...spec.radii] : spec.segments).flatMap((segment) => segment.label ? [segment.label] : []);
                const renderedLengths = Array.from(document.querySelectorAll('text[data-figure-label="segment"]'), (element) => element.textContent);
                expect(renderedLengths.slice().sort()).toEqual(segmentLabels.sort());
                const angularLabels = (spec.type === 'circle_geometry' ? [...spec.sectors, ...spec.arcs] : spec.type === 'basic_geometry' ? spec.angles : [])
                    .flatMap((angle) => angle.label ? [angle.label] : []);
                const renderedAngular = Array.from(document.querySelectorAll('text[data-figure-label="angle"], text[data-figure-label="sector"], text[data-figure-label="arc"]'), (element) => element.textContent);
                expect(renderedAngular.slice().sort()).toEqual(angularLabels.sort());
                const circleLabels = spec.type === 'basic_geometry' ? spec.circles.flatMap((circle) => circle.label ? [circle.label] : []) : [];
                expect(Array.from(document.querySelectorAll('text[data-figure-label="circle"]'), (element) => element.textContent).sort()).toEqual(circleLabels.sort());
                const fixedLabels = [...spec.labels.map((label) => label.text), ...(spec.type !== 'basic_geometry' && spec.title ? [spec.title] : [])];
                const fixedTexts = Array.from(document.querySelectorAll('text[data-figure-label="fixed"]'), (element) => element.textContent);
                for (const value of fixedLabels) expect(fixedTexts).toContain(value);
            }
        }
        for (const expectedText of fixture.mustHaveText ?? []) {
            expect(texts).toContain(expectedText);
        }
        for (const token of fixture.unbrokenText ?? []) {
            expect(Array.from(document.querySelectorAll('text')).some((element) => {
                const lines = element.querySelectorAll('tspan');
                return lines.length ? Array.from(lines).some((line) => line.textContent?.includes(token)) : element.textContent?.includes(token);
            })).toBe(true);
        }
        for (const [element, minimum] of Object.entries(fixture.elementMinimums ?? {})) {
            expect(svg!.match(new RegExp(`<${element}(?:\\s|>)`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(minimum);
        }
    });

    it.each(['basic_geometry', 'coordinate_plane'] as const)('长度标注无法可靠排版时 %s 不返回有缺失的图', (type) => {
        const spec = {
            type,
            points: [{ id: 'A', x: 50, y: 50 }, { id: 'B', x: 51, y: 50 }],
            segments: [{ from: 'A', to: 'B', label: '12cm' }],
            ...(type === 'coordinate_plane' ? { xMin: 0, xMax: 100, yMin: 0, yMax: 100, xStep: 10, yStep: 10 } : {}),
        };
        expect(parseFigureSpec(JSON.stringify(spec))).not.toBeNull();
        expect(renderFigureSpecDetailed(JSON.stringify(spec))).toEqual({
            svg: null, diagnostic: { ok: false, reason: 'renderer_unavailable', type },
        });
    });

    it.each([
        { from: { id: 'A', x: 90, y: 50 }, to: { id: 'B', x: 80, y: 50.6 }, label: '狭小角度' },
        { from: { id: 'A', x: 51, y: 50 }, to: { id: 'B', x: 50, y: 51 }, label: undefined },
    ])('角标无法可靠绘制时不静默漏掉标注', ({ from, to, label }) => {
        const spec = JSON.stringify({
            type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50 }, from, to],
            angles: [{ vertex: 'O', from: 'A', to: 'B', label }],
        });
        expect(parseFigureSpec(spec)).not.toBeNull();
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('有明显角标但文字放不进原角度区域时明确回退', () => {
        const spec = JSON.stringify({
            type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50 }, { id: 'A', x: 90, y: 50 }, { id: 'B', x: 89.848, y: 53.486 }],
            segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
            angles: [{ vertex: 'O', from: 'A', to: 'B', label: '5°' }],
        });
        expect(parseFigureSpec(spec)).not.toBeNull();
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('圆弧和扇形标注的方向元数据与原始端点一致', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'circle_geometry', center: { id: 'O', x: 50, y: 50 }, radius: 30,
            points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 50, y: 20 }],
            sectors: [{ from: 'A', to: 'B', label: '扇形' }], arcs: [{ from: 'A', to: 'B', label: '弧AB' }],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        for (const kind of ['arc', 'sector']) {
            const element = document.querySelector(`text[data-figure-label="${kind}"]`)!;
            expect(element).not.toBeNull();
            expect(Number(element.getAttribute('data-center-x'))).toBe(400);
            expect(Number(element.getAttribute('data-center-y'))).toBe(250);
            expect(Number(element.getAttribute('data-angle-start'))).toBe(0);
            expect(Number(element.getAttribute('data-angle-delta'))).toBeCloseTo(-Math.PI / 2);
            if (kind === 'sector') expect(Number(element.getAttribute('data-region-outer'))).toBe(117);
            else expect(Number(element.getAttribute('data-region-inner'))).toBeGreaterThan(117);
        }
    });

    it('混合圆图共同避让时半径标注仍靠近原半径', () => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((item) => item.id === 'junior-circle-mixed-lengths')!;
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const label = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === '半径')!;
        expect(label).toBeDefined();
        expect(Number(label.getAttribute('x'))).toBeGreaterThan(420);
        expect(Number(label.getAttribute('x'))).toBeLessThan(500);
        expect(Math.abs(Number(label.getAttribute('y')) - 250)).toBeLessThan(40);
    });

    it('混合圆图的扇形说明与相邻弦保留清晰间距', () => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((item) => item.id === 'junior-circle-mixed-lengths')!;
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const label = document.querySelector('text[data-figure-label="sector"]')!;
        const box = {
            left: Number(label.getAttribute('x')) - 18,
            top: Number(label.getAttribute('y')) - 21.6,
            width: 36,
            height: 28.8,
        };
        const chord = { from: { x: 517, y: 250 }, to: { x: 400, y: 133 } };
        const right = box.left + box.width;
        const bottom = box.top + box.height;
        let start = 0;
        let end = 1;
        for (const [origin, delta, lower, upper] of [
            [chord.from.x, chord.to.x - chord.from.x, box.left - 8, right + 8],
            [chord.from.y, chord.to.y - chord.from.y, box.top - 8, bottom + 8],
        ]) {
            const first = (lower - origin) / delta;
            const second = (upper - origin) / delta;
            start = Math.max(start, Math.min(first, second));
            end = Math.min(end, Math.max(first, second));
        }
        expect(start > end).toBe(true);
    });

    it('renders a vertical arithmetic layout without relying on AI SVG coordinates', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'vertical_arithmetic',
            operation: '×',
            top: '34',
            bottom: '25',
            partialProducts: [
                { value: '170', label: '甲' },
                { value: '680', label: '乙', shift: 1 },
            ],
            result: '850',
        }));

        expect(svg).toContain('<svg');
        expect(svg).toContain('34');
        expect(svg).toContain('25');
        expect(svg).toContain('甲');
        expect(svg).toContain('乙');
        expect(svg).toContain('850');
        expect(svg).toContain('<line');
        expect(svg).not.toContain('NaN');
    });

    it('keeps numerator and denominator as separate parts of a fraction', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'fraction',
            numerator: '3',
            denominator: '5',
            model: 'fraction',
        }));

        expect(svg).toContain('>3</text>');
        expect(svg).toContain('>5</text>');
        expect(svg).toContain('stroke-width="2.5"');
    });

    it('rejects fraction diagrams whose partition metadata disagrees with the fraction', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'fraction',
            numerator: '3',
            denominator: '4',
            model: 'circle',
            parts: 5,
            filled: 3,
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'fraction',
            numerator: '3',
            denominator: '4',
            model: 'circle',
            parts: 4,
            filled: 2,
        }))).toBeNull();
    });

    it.each([
        { numerator: 'x', denominator: '4', parts: 4, filled: 2 },
        { numerator: '1+1', denominator: '4', parts: 4, filled: 2 },
        { numerator: '2', denominator: 'x+2', parts: 4, filled: 2 },
        { numerator: '2.0', denominator: '4', parts: 4, filled: 2 },
        { numerator: '−1', denominator: '4', parts: 4, filled: 0 },
    ])('不确定或非非负整数分数不能生成带涂色的分数图：$numerator/$denominator', (fraction) => {
        for (const model of ['bar', 'circle'] as const) {
            const raw = JSON.stringify({ type: 'fraction', ...fraction, model });
            expect(parseFigureSpec(raw)).toBeNull();
            expect(parseFigure('true', '<svg><text>完整旧分数图</text></svg>', raw).figureSvg).toContain('完整旧分数图');
            expect(parseFigure('true', null, raw).figureSvg).toBeNull();
            const group = JSON.stringify({ type: 'figure_group', figures: [
                { label: 'A', figure: { type: 'fraction', numerator: '1', denominator: '2' } },
                { label: 'B', figure: { type: 'fraction', ...fraction, model } },
            ] });
            expect(parseFigure('true', '<svg><text>完整旧图组</text></svg>', group).figureSvg).toContain('完整旧图组');
        }
    });

    it('接受带正号的明确整数分数，同时保留普通上下结构对未知表达式的支持', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'fraction', numerator: '+3', denominator: '+4', model: 'bar', parts: 4, filled: 3,
        }))).not.toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'fraction', numerator: 'x+1', denominator: 'x+2', model: 'fraction',
        }))).not.toBeNull();
    });

    it.each([1, 4, 24])('shades the entire fraction circle when all %i parts are filled', (parts) => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'fraction', numerator: String(parts), denominator: String(parts), model: 'circle', parts, filled: parts,
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('circle[fill="#dbeafe"]')).not.toBeNull();
        expect(document.querySelector('path')).toBeNull();
        expect(document.querySelectorAll('line')).toHaveLength(parts === 1 ? 0 : parts);
    });

    it('does not shade the fraction circle when no parts are filled', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'fraction', numerator: '0', denominator: '4', model: 'circle', parts: 4, filled: 0,
        }));
        expect(svg).not.toBeNull();
        expect(svg).not.toContain('fill="#dbeafe"');
    });

    it('rejects geometry references to unknown points instead of drawing incomplete figures', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }],
            segments: [{ from: 'A', to: 'B' }],
        }))).toBeNull();
    });

    it('点名没有可靠位置时保留结构并使渲染回退，不能覆盖其它标注', () => {
        const raw = JSON.stringify({
            type: 'basic_geometry', points: [{ id: 'A', x: 50, y: 50, label: 'A' }],
            labels: Array.from({ length: 9 }, (_, index) => ({ text: '预留标注预留标注预留标注', x: 50, y: 20 + index * 7.5 })),
        });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable', type: 'basic_geometry' } });
    });

    it('rejects zero-length segments and degenerate polygons', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 80 }],
            segments: [{ from: 'A', to: 'A' }],
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'A', x: 10, y: 10 },
                { id: 'B', x: 50, y: 50 },
                { id: 'C', x: 90, y: 90 },
            ],
            polygons: [{ points: ['A', 'B', 'C'] }],
        }))).toBeNull();
    });

    it.each([
        {
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 80 }],
            segments: [{ from: 'A', to: 'B', label: '5厘米' }, { from: 'B', to: 'A', label: '5厘米' }],
        },
        {
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 80 }],
            segments: [{ from: 'A', to: 'B', label: '5厘米' }, { from: 'B', to: 'A', label: '6厘米', dashed: true }],
        },
        {
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 80 }],
            segments: [{ from: 'A', to: 'B', label: '5厘米' }, { from: 'B', to: 'A', label: '6厘米' }],
        },
        {
            type: 'coordinate_plane',
            xMin: 0, xMax: 10, yMin: 0, yMax: 10, xStep: 2, yStep: 2,
            points: [{ id: 'A', x: 2, y: 2 }, { id: 'B', x: 8, y: 8 }],
            segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
        },
    ])('rejects exact duplicate undirected segments instead of drawing one edge twice', (spec) => {
        expect(parseFigureSpec(JSON.stringify(spec))).toBeNull();
    });

    it('keeps a single labeled segment on a polygon boundary', () => {
        const spec = {
            type: 'basic_geometry',
            points: [
                { id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 10 },
                { id: 'C', x: 80, y: 80 }, { id: 'D', x: 10, y: 80 },
            ],
            polygons: [{ points: ['A', 'B', 'C', 'D'] }],
            segments: [{ from: 'A', to: 'B', label: '5厘米' }],
        };
        expect(parseFigureSpec(JSON.stringify(spec))).not.toBeNull();
        expect(renderFigureSpec(JSON.stringify(spec))).toContain('>5厘米</text>');
    });

    it('保留同一条边上不同且不矛盾的标签', () => {
        const spec = {
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }, { id: 'B', x: 80, y: 80 }],
            segments: [{ from: 'A', to: 'B', label: '5厘米' }, { from: 'B', to: 'A', label: '50毫米' }],
        };
        expect(parseFigureSpec(JSON.stringify(spec))).not.toBeNull();
        expect(renderFigureSpec(JSON.stringify(spec))).not.toBeNull();
    });

    it('rejects self-intersecting polygons and coincident geometry points', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'A', x: 10, y: 10 },
                { id: 'B', x: 90, y: 70 },
                { id: 'C', x: 10, y: 90 },
                { id: 'D', x: 70, y: 10 },
            ],
            polygons: [{ points: ['A', 'B', 'C', 'D'] }],
        }))).toBeNull();

        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'A', x: 20, y: 20 }, { id: 'B', x: 20, y: 20 }],
            segments: [{ from: 'A', to: 'B' }],
        }))).toBeNull();
    });

    it('rejects mismatched chart categories and values', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'bar_chart',
            categories: ['一', '二'],
            values: [1],
        }))).toBeNull();
    });

    it('wraps long chart category labels instead of shrinking them into unreadable text', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'bar_chart',
            categories: ['第一季度语文平均成绩统计数据', '第二季度数学平均成绩统计数据'],
            values: [4, 5],
        }));

        expect(svg).not.toBeNull();
        expect(svg).toContain('<tspan');
        expect(svg).toContain('第一季度');
        expect(svg).toContain('第二季度');
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('柱状图数据值不落入柱体或相邻文字框', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'bar_chart', categories: ['甲', '乙', '丙'], values: [4, 2, 5], unit: '个', title: '数量',
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const bars = Array.from(document.querySelectorAll('rect')).filter((element) => element.getAttribute('fill') === '#dbeafe');
        const valueLabels = Array.from(document.querySelectorAll('text')).filter((element) => ['4', '2', '5'].includes(element.textContent ?? ''));
        expect(bars).toHaveLength(3);
        expect(valueLabels).toHaveLength(3);
        for (const value of ['4', '2', '5']) {
            const label = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === value);
            expect(label, `缺少柱状图数据值 ${value}`).not.toBeUndefined();
            const x = Number(label?.getAttribute('x'));
            const y = Number(label?.getAttribute('y'));
            const width = value.length * 16 * 0.62;
            const box = { left: x - width / 2, right: x + width / 2, top: y - 16 * 1.2, bottom: y + 16 * 0.4 };
            expect(bars.every((bar) => {
                const left = Number(bar.getAttribute('x'));
                const right = left + Number(bar.getAttribute('width'));
                const top = Number(bar.getAttribute('y'));
                const bottom = top + Number(bar.getAttribute('height'));
                return box.right <= left || box.left >= right || box.bottom <= top || box.top >= bottom;
            }), `数据值 ${value} 不能落入柱体`).toBe(true);
        }
    });

    it('柱状图保留原图纵轴刻度间隔，并把刻度文字放在纵轴左侧', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'bar_chart', categories: ['甲', '乙'], values: [5, 10], tickStep: 5,
        }));

        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const axisLabels = Array.from(document.querySelectorAll('text')).filter((element) => (
            element.getAttribute('text-anchor') === 'end' && element.getAttribute('x') === '88'
        ));
        expect(axisLabels.map((element) => element.textContent)).toEqual(['0', '5', '10']);
        expect(axisLabels.every((element) => Number(element.getAttribute('x')) < 100)).toBe(true);
        expect(Array.from(document.querySelectorAll('line')).some((element) => (
            element.getAttribute('x1') === '94' && element.getAttribute('x2') === '100'
        ))).toBe(true);
    });

    it('折线图保留小数纵轴刻度，并与数据值标签一起排版', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二', '三'], values: [0.2, 0.5, 0.3], maxValue: 0.5, tickStep: 0.1,
        }));

        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const axisLabels = Array.from(document.querySelectorAll('text')).filter((element) => (
            element.getAttribute('text-anchor') === 'end' && element.getAttribute('x') === '88'
        ));
        expect(axisLabels.map((element) => element.textContent)).toEqual(['0', '0.1', '0.2', '0.3', '0.4', '0.5']);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it.each([
        { type: 'bar_chart', categories: ['甲', '乙'], values: [5, 10], tickStep: 20 },
        { type: 'line_chart', categories: ['一', '二'], values: [0, 1], tickStep: 0.01 },
    ])('纵轴刻度少于两个或过密时回退：$type', (spec) => {
        expect(renderFigureSpec(JSON.stringify(spec))).toBeNull();
    });

    it('falls back when a chart category cannot fit within the bounded label area', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'bar_chart',
            categories: [
                '这是一个长度明显超过图表标签区域的分类名称',
                '这是另一个长度明显超过图表标签区域的分类名称',
                '第三个长度明显超过图表标签区域的分类名称',
                '第四个长度明显超过图表标签区域的分类名称',
            ],
            values: [1, 2, 3, 4],
        }))).toBeNull();
    });

    it('图表数据值、单位或标题低于最小可读字号时整图回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'bar_chart', categories: Array.from({ length: 20 }, (_, index) => String(index + 1)), values: Array<number>(20).fill(123456),
        }))).toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二'], values: [1, 2], unit: '这是一个无法在单位区域完整显示的单位',
        }))).toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'bar_chart', categories: ['一'], values: [1], title: '长'.repeat(60),
        }))).toBeNull();
    });

    it('returns null for invalid JSON so the legacy SVG can remain the fallback', () => {
        expect(renderFigureSpec('{bad json')).toBeNull();
    });

    it('normalizes full-width arithmetic symbols before rendering', () => {
        const spec = parseFigureSpec(JSON.stringify({
            type: 'vertical_arithmetic',
            operation: '×',
            top: ' １２ ',
            bottom: ' ２５ ',
            result: '３００',
        }));

        expect(spec).toMatchObject({ operation: '×', top: '12', bottom: '25', result: '300' });
    });

    it.each(['12cm²', '5m³', 'A₁', 'x²+y²', '½', '①', 'ℓ', '℃', '𝑥∈ℝ'])('保留数学字形 %s，不做兼容性替换', (label) => {
        const raw = JSON.stringify({ type: 'table', headers: ['符号'], rows: [[label]] });
        expect(parseFigureSpec(raw)).toMatchObject({ rows: [[label]] });
        const svg = renderFigureSpec(raw);
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(Array.from(document.querySelectorAll('text'), (element) => element.textContent)).toContain(label);
    });

    it('全角转换与空白清理保留上下标和组合字符', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'table', headers: ['  Ａ₁  '], rows: [['１２ｃｍ²　＋  e\u0301']],
        }))).toMatchObject({ headers: ['A₁'], rows: [['12cm² + é']] });
    });

    it.each(['basic_geometry', 'coordinate_plane', 'circle_geometry'])('%s 中带下标的点与普通数字点保持不同引用', (type) => {
        const points = [{ id: 'A₁', x: 80, y: 50, label: 'A₁' }, { id: 'A1', x: 50, y: 20, label: 'A1' }];
        const spec = type === 'circle_geometry'
            ? { type, center: { id: 'O', x: 50, y: 50 }, radius: 30, points, chords: [{ from: 'A₁', to: 'A1' }] }
            : { type, points, segments: [{ from: 'A₁', to: 'A1' }], xMin: 0, xMax: 100, yMin: 0, yMax: 100, xStep: 10, yStep: 10 };
        expect(parseFigureSpec(JSON.stringify(spec))).toMatchObject({ points });
        const svg = renderFigureSpec(JSON.stringify(spec));
        expect(svg).not.toBeNull();
        expect(svg).toContain('>A₁</text>');
        expect(svg).toContain('>A1</text>');
    });

    it('recomputes numeric multiplication partial products from the declared shifts', () => {
        const spec = parseFigureSpec(JSON.stringify({
            type: 'vertical_arithmetic',
            operation: '×',
            top: '34',
            bottom: '25',
            partialProducts: [
                { value: '999', label: '甲' },
                { value: '999', label: '乙', shift: 1 },
            ],
            result: '999',
        }));

        expect(spec).toMatchObject({
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '850',
        });
    });

    it('keeps long vertical arithmetic inside its dynamic canvas', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'vertical_arithmetic',
            operation: '×',
            top: '12345678',
            bottom: '87654321',
            partialProducts: Array.from({ length: 8 }, (_, shift) => ({ value: '1', shift })),
            result: '99999999',
        }));

        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(Number(document.documentElement.getAttribute('height'))).toBeLessThanOrEqual(800);
        expect(document.querySelectorAll('text[data-arithmetic-row="partial"]')).toHaveLength(8);
        expect(svg!).toContain('1082152022374638');
        expect(svg!).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('keeps long tables inside a bounded dynamic canvas', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'table',
            headers: ['序号', '名称', '数量'],
            rows: Array.from({ length: 30 }, (_, index) => [String(index + 1), `项目${index + 1}`, String(index % 5)]),
        }));

        expect(svg).toContain('<svg');
        const height = Number(svg!.match(/<svg[^>]+height="([0-9.]+)"/)?.[1]);
        expect(height).toBeGreaterThanOrEqual(500);
        expect(height).toBeLessThanOrEqual(800);
        expect(svg!).toContain('项目30');
        expect(svg!).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('wraps readable Chinese table cells when the columns are narrow', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'table',
            headers: ['项目名称', '数量', '备注', '阶段', '科目', '班级', '日期', '教师'],
            rows: [['第一季度语文', '4', '重点复习', '第一阶段', '语文', '六年级一班', '2026年1月', '王老师']],
        }));

        expect(svg).not.toBeNull();
        expect(svg).toContain('<tspan');
        expect(svg).toContain('第一季度');
    });

    it.each([
        { rows: [] },
        { rows: [['苹果', '4']] },
        { rows: [['苹果', '4'], ['梨', '2']] },
    ])('closes the table bottom even with no body rows ($rows)', ({ rows }) => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'table', headers: ['项目', '数量'], rows }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const lines = Array.from(document.querySelectorAll('line'));
        const horizontal = lines.filter((element) => element.getAttribute('y1') === element.getAttribute('y2'));
        const vertical = lines.filter((element) => element.getAttribute('x1') === element.getAttribute('x2'));
        expect(horizontal).toHaveLength(rows.length + 2);
        expect(vertical).toHaveLength(3);
        const bottom = Math.max(...vertical.map((element) => Number(element.getAttribute('y2'))));
        expect(horizontal.some((element) => Number(element.getAttribute('y1')) === bottom)).toBe(true);
    });

    it('sizes table rows independently so a three-line header cannot spill into the body', () => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((entry) => entry.id === 'primary-table-three-line-header')!;
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const boundaries = Array.from(document.querySelectorAll('line'))
            .filter((element) => element.getAttribute('y1') === element.getAttribute('y2'))
            .map((element) => Number(element.getAttribute('y1')));
        expect(boundaries).toHaveLength(4);
        expect(boundaries[1] - boundaries[0]).toBeGreaterThan(60);
        expect(boundaries[2] - boundaries[1]).toBeLessThan(30);
        expect(boundaries[3] - boundaries[2]).toBeGreaterThan(60);
        for (const [index, element] of Array.from(document.querySelectorAll('text')).entries()) {
            const rowIndex = Math.floor(index / 8);
            const size = Number(element.getAttribute('font-size'));
            const firstBaseline = Number(element.getAttribute('y'));
            const additionalHeight = Array.from(element.querySelectorAll('tspan'))
                .reduce((total, span) => total + Number(span.getAttribute('dy')), 0);
            expect(firstBaseline - size).toBeGreaterThanOrEqual(boundaries[rowIndex]);
            expect(firstBaseline + additionalHeight + size * 0.2).toBeLessThanOrEqual(boundaries[rowIndex + 1]);
        }
    });

    it('falls back when a dense table cannot fit inside the bounded canvas', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'table',
            headers: Array.from({ length: 12 }, (_, index) => `第${index + 1}列`),
            rows: Array.from({ length: 30 }, () => Array.from({ length: 12 }, () => '第一季度语文平均成绩')),
        }))).toBeNull();
    });

    it('密集表格仍保持至少 12px 正文字号，能容纳时不因行数丢失可读性', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'table',
            headers: ['项目', '数量'],
            rows: Array.from({ length: 30 }, (_, index) => [`项目${index + 1}`, String(index + 1)]),
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'));
        expect(texts).toHaveLength(62);
        expect(texts.map((element) => element.textContent)).toContain('项目30');
        const fonts = texts.map((element) => Number(element.getAttribute('font-size')));
        expect(Math.min(...fonts)).toBeGreaterThanOrEqual(12);
    });

    it('直接排版的长说明无法达到可读字号时整图回退', () => {
        const raw = JSON.stringify({
            type: 'fraction',
            numerator: '1',
            denominator: '2',
            label: '说明'.repeat(30),
            model: 'fraction',
        });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('rejects number-line points outside the declared range', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'number_line',
            min: 0,
            max: 10,
            step: 1,
            points: [{ value: 11, label: '超出范围' }],
        }))).toBeNull();
    });

    it('rejects number lines whose labels would be too dense to read', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'number_line',
            min: 0,
            max: 80,
            step: 1,
        }))).toBeNull();
    });

    it('数轴点名低于最小可读字号时回退，不输出细小文字', () => {
        const raw = JSON.stringify({
            type: 'number_line', min: 0, max: 4, step: 1,
            points: [{ value: 2, label: '这是一个过长的数轴点名称' }],
        });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('密集负数数轴统一调整字号，完整保留所有可读刻度', () => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'number_line', min: -12, max: 12, step: 1 }));
        expect(svg).not.toBeNull();
        const texts = Array.from(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('text'));
        expect(texts.map((element) => element.textContent)).toEqual(Array.from({ length: 25 }, (_, index) => String(index - 12)));
        const sizes = texts.map((element) => Number(element.getAttribute('font-size')));
        expect(new Set(sizes).size).toBe(1);
        expect(sizes[0]).toBeGreaterThanOrEqual(12);
        expect(sizes[0]).toBeLessThan(18);
    });

    it('数轴在最小字号仍无法容纳相邻数值时整图回退', () => {
        const raw = JSON.stringify({ type: 'number_line', min: 10000000000, max: 10000000024, step: 1 });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it.each([
        { min: 0, max: 0.3, step: 0.1, expected: ['0', '0.1', '0.2', '0.3'] },
        { min: 0, max: 0.00003, step: 0.00001, expected: ['0', '0.00001', '0.00002', '0.00003'] },
    ])('小数数轴完整保留刻度值和端点：$max / $step', ({ min, max, step, expected }) => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'number_line', min, max, step }));
        expect(svg).not.toBeNull();
        const texts = Array.from(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('text'));
        expect(texts.map((element) => element.textContent)).toEqual(expected);
    });

    it('坐标轴使用同样的完整小数刻度，不因浮点除法遗漏末端', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane', xMin: 0, xMax: 0.3, xStep: 0.1, yMin: 0, yMax: 0.3, yStep: 0.1,
        }));
        expect(svg).not.toBeNull();
        const texts = Array.from(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('text'));
        expect(texts.map((element) => element.textContent)).toEqual(['0', '0.1', '0.2', '0.3', '0.1', '0.2', '0.3']);
    });

    it('接近零但不等于零的纵轴刻度仍显示原值', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane', xMin: 0, xMax: 2, xStep: 1, yMin: 0.001, yMax: 2.001, yStep: 1,
        }));
        expect(svg).not.toBeNull();
        const texts = Array.from(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('text'));
        expect(texts.map((element) => element.textContent)).toEqual(['0', '1', '2', '0.001', '1.001', '2.001']);
    });

    it.each([
        ['横轴不包含零', { xMin: 1, xMax: 3, xStep: 1 }],
        ['横轴跨零但步长跳过零', { xMin: -4, xMax: 5, xStep: 3 }],
        ['横轴已经包含零', { xMin: -2, xMax: 2, xStep: 1 }],
    ] as const)('%s 时坐标轴保留唯一的原点零刻度标签', (_scenario, range) => {
        const result = renderFigureSpecDetailed(JSON.stringify({
            type: 'coordinate_plane',
            ...range,
            yMin: -1,
            yMax: 1,
            yStep: 1,
        }));
        const svg = result.svg;
        expect(svg, `${JSON.stringify(range)}: ${JSON.stringify(result.diagnostic)}`).not.toBeNull();
        const texts = Array.from(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('text'));
        expect(texts.filter((element) => element.textContent === '0')).toHaveLength(1);
        if (range.xMin > 0) expect(texts.map((element) => element.textContent)).toContain('-1');
    });

    it.each(['number_line', 'coordinate_plane'])('%s 精确核对 25 个刻度的容量，不接受少算一个的溢出输入', (type) => {
        const spec = type === 'number_line'
            ? { type, min: 0.3, max: 2.8, step: 0.1 }
            : { type, xMin: 0.3, xMax: 2.8, xStep: 0.1, yMin: 0, yMax: 2, yStep: 1 };
        expect(parseFigureSpec(JSON.stringify(spec))).toBeNull();
    });

    it('rejects grid cells outside the declared grid instead of silently dropping them', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'grid_shape',
            rows: 2,
            cols: 2,
            filledCells: [{ row: 2, col: 0 }],
        }))).toBeNull();
    });

    it('rejects duplicate grid labels that would make the rendered meaning ambiguous', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'grid_shape',
            rows: 2,
            cols: 2,
            cellLabels: [
                { row: 0, col: 0, text: 'A' },
                { row: 0, col: 0, text: 'B' },
            ],
        }))).toBeNull();
    });

    it('长方格标签按行完整显示，扩展方格尺寸而不缩成极小文字', () => {
        const label = '第一季度数学成绩';
        const svg = renderFigureSpec(JSON.stringify({
            type: 'grid_shape', rows: 5, cols: 5,
            cellLabels: [{ row: 2, col: 3, text: label }],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const text = document.querySelector('text')!;
        expect(text.textContent).toBe(label);
        expect(text.querySelectorAll('tspan').length).toBeGreaterThan(1);
        expect(text.querySelectorAll('tspan').length).toBeLessThanOrEqual(3);
        expect(Number(text.getAttribute('font-size'))).toBeGreaterThanOrEqual(12);
        const cells = Array.from(document.querySelectorAll('rect[stroke="#111827"]'));
        expect(cells).toHaveLength(25);
        expect(Number(cells[0].getAttribute('width'))).toBeGreaterThan(60);
    });

    it('密集方格中的单字仍保持最小字号和正方形尺寸', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'grid_shape', rows: 30, cols: 30,
            cellLabels: [{ row: 0, col: 0, text: '甲' }, { row: 29, col: 29, text: '乙' }],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'));
        expect(texts.map((text) => text.textContent)).toEqual(['甲', '乙']);
        for (const text of texts) expect(Number(text.getAttribute('font-size'))).toBeGreaterThanOrEqual(12);
        const cells = Array.from(document.querySelectorAll('rect[stroke="#111827"]'));
        expect(cells).toHaveLength(900);
        const size = Number(cells[0].getAttribute('width'));
        expect(size).toBeGreaterThanOrEqual(20);
        expect(cells.every((cell) => Number(cell.getAttribute('width')) === size && Number(cell.getAttribute('height')) === size)).toBe(true);
        expect(Number(document.documentElement.getAttribute('viewBox')!.split(/\s+/)[3])).toBeLessThanOrEqual(800);
    });

    it('密集方格无法容纳完整标签时回退，避免越格或裁掉文字', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'grid_shape', rows: 30, cols: 30,
            cellLabels: [{ row: 0, col: 0, text: '第一季度数学成绩' }],
        }))).toBeNull();
    });

    it.each(['12345', '−12.5', '3/25', '1,234.5', '12.5%', '12cm²', '12 厘米', 'A₁=12', '3×10⁴', 'x²+2x+1', '−0.75m/s', '𝑥²+1', 'xⁿ', 'A′=12'])('方格标签中的 %s 保持在同一行', (token) => {
        const label = `数值为${token}时`;
        const svg = renderFigureSpec(JSON.stringify({
            type: 'grid_shape', rows: 5, cols: 5, cellLabels: [{ row: 2, col: 3, text: label }],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const element = Array.from(document.querySelectorAll('text')).find((element) => element.textContent === label);
        expect(element).toBeDefined();
        const lines = element!.querySelectorAll('tspan');
        expect(lines.length).toBeGreaterThan(1);
        expect(Array.from(lines, (line) => line.textContent).some((value) => value?.includes(token))).toBe(true);
    });

    it('方格无法容纳完整数值时回退，不能把它拆成多个数', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'grid_shape', rows: 5, cols: 5,
            cellLabels: [{ row: 2, col: 3, text: '1234567890123456' }],
        }))).toBeNull();
    });

    it('窄列表格无法容纳完整数值时回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'table', headers: Array.from({ length: 12 }, (_, index) => `列${index + 1}`),
            rows: [['123456789012']],
        }))).toBeNull();
    });

    it('图表分类无法容纳完整数值时回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'bar_chart', categories: [...Array<string>(11).fill('甲'), '123456'], values: Array<number>(12).fill(1),
        }))).toBeNull();
    });

    it('渲染扇形统计图时保留原始数值、单位和类别，按原始比例绘制扇区', () => {
        const raw = {
            type: 'pie_chart',
            categories: ['语文', '数学', '英语'],
            values: [4, 3, 2],
            unit: '人',
            title: '最喜欢的学科',
        };
        const svg = renderFigureSpec(JSON.stringify(raw));
        expect(svg).not.toBeNull();
        expect(svg).toBe(renderFigureSpec(JSON.stringify(raw)));
        expect(svg).toContain('语文：4 人');
        expect(svg).toContain('数学：3 人');
        expect(svg).toContain('英语：2 人');
        expect(svg).toContain('最喜欢的学科');
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelectorAll('path')).toHaveLength(3);
        expect(document.querySelectorAll('rect')).toHaveLength(4);
        expect(document.querySelectorAll('circle')).toHaveLength(1);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('扇形统计图保留零值类别但不生成零面积扇区，并拒绝全零数据', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'pie_chart', categories: ['甲', '乙', '丙'], values: [4, 0, 2],
        }));
        expect(svg).not.toBeNull();
        expect(svg).toContain('乙：0');
        expect(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('path')).toHaveLength(2);
        expect(renderFigureSpec(JSON.stringify({
            type: 'pie_chart', categories: ['甲', '乙'], values: [0, 0],
        }))).toBeNull();
    });

    it('扇形统计图分类过多或对应关系不完整时回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'pie_chart', categories: Array.from({ length: 9 }, (_, index) => `分类${index + 1}`), values: Array<number>(9).fill(1),
        }))).toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'pie_chart', categories: ['甲', '乙'], values: [1],
        }))).toBeNull();
    });

    it('象形统计图按每个图标代表的数量绘制，并保留图例和原始数值', () => {
        const raw = {
            type: 'pictogram',
            categories: ['苹果', '梨'],
            values: [8, 4],
            perIcon: 2,
            icon: 'apple',
            unit: '个',
            title: '水果数量',
        };
        const svg = renderFigureSpec(JSON.stringify(raw));
        expect(svg).not.toBeNull();
        expect(svg).toBe(renderFigureSpec(JSON.stringify(raw)));
        expect(svg).toContain('图例：每个图标表示2个');
        expect(svg).toContain('8 个');
        expect(svg).toContain('4 个');
        expect(svg).toContain('data-figure-pictogram-icon="apple"');
        expect(new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('g[data-figure-pictogram-icon="apple"]')).toHaveLength(7);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('象形统计图无法完整表示半个图标、超过16个图标或数据不一致时回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'pictogram', categories: ['甲'], values: [3], perIcon: 2, icon: 'person',
        }))).toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'pictogram', categories: ['甲'], values: [34], perIcon: 2, icon: 'person',
        }))).toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'pictogram', categories: ['甲', '乙'], values: [2], perIcon: 1, icon: 'person',
        }))).toBeNull();
    });

    it('renders a coordinate plane with points and segments from structured data', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane',
            xMin: -2,
            xMax: 4,
            yMin: -2,
            yMax: 4,
            xStep: 1,
            yStep: 1,
            points: [
                { id: 'A', x: 1, y: 2, label: 'A' },
                { id: 'B', x: 3, y: 1, label: 'B', color: 'blue' },
            ],
            segments: [{ from: 'A', to: 'B', label: 'AB' }],
        }));

        expect(svg).toContain('<svg');
        expect(svg).toContain('>A</text>');
        expect(svg).toContain('>B</text>');
        expect(svg).toContain('>AB</text>');
        expect(svg).toContain('<path');
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it.each([
        { xMin: 0, xMax: 4, yMin: 0, yMax: 8 },
        { xMin: 0, xMax: 8, yMin: 0, yMax: 4 },
        { xMin: -2, xMax: 4, yMin: -2, yMax: 4 },
    ])('preserves a unit square in coordinate ranges $xMin..$xMax and $yMin..$yMax', (range) => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane',
            ...range,
            points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 0 }, { id: 'C', x: 0, y: 1 }],
        }));

        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const [origin, horizontal, vertical] = Array.from(document.querySelectorAll('circle'));
        const horizontalUnit = Number(horizontal.getAttribute('cx')) - Number(origin.getAttribute('cx'));
        const verticalUnit = Number(origin.getAttribute('cy')) - Number(vertical.getAttribute('cy'));
        expect(horizontalUnit).toBeGreaterThan(0);
        expect(horizontalUnit).toBeCloseTo(verticalUnit, 8);
    });

    it('falls back when equal-unit coordinate ticks are too dense to read', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane', xMin: 0, xMax: 100, xStep: 10, yMin: 0, yMax: 1, yStep: 0.2,
        }))).toBeNull();
    });

    it('keeps line-chart endpoints away from the axes', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'line_chart',
            categories: ['一月', '二月', '三月'],
            values: [2, 5, 3],
        }));
        const axis = svg?.match(/<line x1="100" y1="70" x2="100" y2="400"/);
        const firstPoint = svg?.match(/<circle cx="([\d.]+)" cy="[\d.]+" r="5"/);
        expect(axis).not.toBeNull();
        expect(firstPoint).not.toBeNull();
        expect(Number(firstPoint![1])).toBeGreaterThan(100);
    });

    it('保留小数折线图的实际上限，不把 0.5 的数据压到 1 的一半以下', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二'], values: [0.2, 0.5],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const points = Array.from(document.querySelectorAll('circle[r="5"]'), (element) => Number(element.getAttribute('cy')));
        expect(points).toHaveLength(2);
        expect(points[1]).toBe(70);
        expect(points[0]).toBeGreaterThan(points[1]);
    });

    it('保留全负数折线图的零基线，不生成错误的正数上限', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二'], values: [-5, -3],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const points = Array.from(document.querySelectorAll('circle[r="5"]'), (element) => Number(element.getAttribute('cy')));
        expect(points).toEqual([400, 268]);
    });

    it('允许明确声明全负数折线图的负数上限', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二'], values: [-5, -3], minValue: -6, maxValue: -2,
        }));
        expect(svg).not.toBeNull();
        expect(svg).toContain('cy="317.5"');
        expect(svg).toContain('cy="152.5"');
    });

    it('折线数据标签避开线段和相邻分类文字，无法排版时整图回退', () => {
        const readable = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一月', '二月', '三月'], values: [2, 5, 3],
        }));
        expect(readable).not.toBeNull();
        const dense = renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: Array.from({ length: 30 }, (_, index) => String(index + 1)), values: Array<number>(30).fill(1234),
        }));
        expect(dense).toBeNull();
    });

    it('折线极值标签与标题或坐标轴无法同时避让时整图回退', () => {
        expect(renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: ['一', '二'], values: [1, 1], title: '图表标题',
        }))).not.toBeNull();
        expect(renderFigureSpec(JSON.stringify({
            type: 'line_chart', categories: Array.from({ length: 20 }, (_, index) => String(index + 1)), values: Array<number>(20).fill(1234), title: '图表标题',
        }))).toBeNull();
    });

    it('renders a structured circle with radius, chord, diameter, arc and sector data', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50, label: 'O' },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50, label: 'A' },
                { id: 'B', x: 50, y: 20, label: 'B' },
                { id: 'C', x: 20, y: 50, label: 'C' },
                { id: 'D', x: 50, y: 80, label: 'D' },
            ],
            radii: [{ to: 'A', label: '半径' }],
            chords: [{ from: 'A', to: 'B', label: '弦AB' }],
            diameters: [{ from: 'A', to: 'C', label: '直径AC' }],
            sectors: [{ from: 'A', to: 'B', fill: 'lightblue', label: '扇形' }],
            arcs: [{ from: 'C', to: 'D', label: '弧CD', dashed: true }],
        }));

        expect(svg).toContain('<svg');
        expect(svg).toContain('半径');
        expect(svg).toContain('弦AB');
        expect(svg).toContain('直径AC');
        expect(svg).toContain('扇形');
        expect(svg).toContain('弧CD');
        expect(svg).toContain('stroke-dasharray="7 5"');
        expect(svg).toContain('stroke-width="2"');
        expect(svg?.indexOf('fill="#dbeafe"')).toBeGreaterThan(svg?.indexOf('fill="#fff" stroke="none"') ?? -1);
        expect(svg?.indexOf('fill="none" stroke="#111827"')).toBeGreaterThan(svg?.indexOf('fill="#dbeafe"') ?? -1);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('明确声明优弧时保留端点并使用大弧', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
            ],
            arcs: [{ from: 'A', to: 'B', arcType: 'major', label: '优弧AB' }],
        }));

        expect(svg).not.toBeNull();
        expect(svg).toContain('优弧AB');
        expect(svg).toContain('A 117 117 0 1 1');
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('用第三个圆周点区分两个半圆，拒绝没有方向或错误弧型的描述', () => {
        const base = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 20, y: 50 },
                { id: 'C', x: 50, y: 20 },
                { id: 'D', x: 50, y: 80 },
            ],
        };
        const ambiguous = renderFigureSpec(JSON.stringify({
            ...base,
            arcs: [{ from: 'A', to: 'B' }],
        }));
        const throughTop = renderFigureSpec(JSON.stringify({
            ...base,
            arcs: [{ from: 'A', to: 'B', through: 'C' }],
        }));
        const throughBottom = renderFigureSpec(JSON.stringify({
            ...base,
            arcs: [{ from: 'A', to: 'B', through: 'D' }],
        }));
        const mislabeled = renderFigureSpec(JSON.stringify({
            ...base,
            arcs: [{ from: 'A', to: 'B', through: 'C', arcType: 'major' }],
        }));

        expect(ambiguous).toBeNull();
        expect(throughTop).toContain('A 117 117 0 0 0');
        expect(throughBottom).toContain('A 117 117 0 0 1');
        expect(mislabeled).toBeNull();
    });

    it('第三点与弧型冲突时拒绝结构化弧线', () => {
        const spec = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
                { id: 'C', x: 20, y: 50 },
            ],
            arcs: [{ from: 'A', to: 'B', through: 'C', arcType: 'minor' }],
        };

        expect(parseFigureSpec(JSON.stringify(spec))).toBeNull();
        expect(renderFigureSpec(JSON.stringify(spec))).toBeNull();
    });

    it('第三点不能是端点或不在圆周上', () => {
        const endpoint = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 50, y: 20 }],
            arcs: [{ from: 'A', to: 'B', through: 'A' }],
        };
        const offCircle = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
                { id: 'T', x: 60, y: 50 },
            ],
            arcs: [{ from: 'A', to: 'B', through: 'T' }],
        };

        expect(parseFigureSpec(JSON.stringify(endpoint))).toBeNull();
        expect(parseFigureSpec(JSON.stringify(offCircle))).toBeNull();
    });

    it('接近直径的端点必须提供第三点并省略弧型，保留原有点位', () => {
        const spec = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 20.001, y: 49.738 },
                { id: 'C', x: 50, y: 20 },
            ],
            arcs: [{ from: 'A', to: 'B', arcType: 'major', through: 'C' }],
        };

        expect(parseFigureSpec(JSON.stringify(spec))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            ...spec, arcs: [{ from: 'A', to: 'B' }],
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            ...spec, arcs: [{ from: 'A', to: 'B', through: 'C' }],
        }))).not.toBeNull();
    });

    it.each(['arcs', 'sectors'] as const)('%s 默认仍绘制劣弧，第三点可以明确选择优弧', (collection) => {
        const base = {
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
                { id: 'C', x: 20, y: 50 },
            ],
        };
        const minor = renderFigureSpec(JSON.stringify({
            ...base, [collection]: [{ from: 'A', to: 'B' }],
        }));
        const major = renderFigureSpec(JSON.stringify({
            ...base, [collection]: [{ from: 'A', to: 'B', through: 'C' }],
        }));
        expect(minor).toContain('A 117 117 0 0 0');
        expect(major).toContain('A 117 117 0 1 1');
        expect(parseFigureSpec(JSON.stringify({
            ...base, [collection]: [{ from: 'A', to: 'B', through: 'C', arcType: 'minor' }],
        }))).toBeNull();
    });

    it.each([0.2, -0.2, -89.8, -90.2])('第三点与端点仅相差 %s 度时回退，包括跨角度零点的情况', (angle) => {
        const radians = angle * Math.PI / 180;
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
                { id: 'T', x: 50 + 30 * Math.cos(radians), y: 50 + 30 * Math.sin(radians) },
            ],
            arcs: [{ from: 'A', to: 'B', through: 'T' }],
        }))).toBeNull();
    });

    it('容差内的圆周点按原方向对齐半径，使弧线与底圆相接', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [{ id: 'A', x: 79.5, y: 50 }, { id: 'B', x: 50, y: 19.5 }],
            arcs: [{ from: 'A', to: 'B' }],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('path')?.getAttribute('d')).toBe('M 517 250 A 117 117 0 0 0 400 133');
        const vertices = Array.from(document.querySelectorAll('circle[r="3.5"]')).slice(1);
        expect(vertices).toHaveLength(2);
        for (const point of vertices) {
            expect(Math.hypot(Number(point.getAttribute('cx')) - 400, Number(point.getAttribute('cy')) - 250)).toBeCloseTo(117, 5);
        }
    });

    it.each(['missing', 'O'])('第三点引用 %s 时拒绝输出不完整弧线', (through) => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 }, radius: 30,
            points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 50, y: 20 }],
            arcs: [{ from: 'A', to: 'B', through }],
        }))).toBeNull();
    });

    it('弧标注与位于弧中点的顶点标注保持阅读间隔', () => {
        const fixture = STRUCTURED_FIGURE_FIXTURES.find((item) => item.id === 'junior-circle-major-and-semicircle')!;
        const svg = renderFigureSpec(JSON.stringify(fixture.spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const labels = Array.from(document.querySelectorAll('text'));
        const arcLabel = labels.find((element) => element.textContent === '半圆')!;
        const vertexLabel = labels.find((element) => element.textContent === 'B')!;
        expect(Number(vertexLabel.getAttribute('y')) - Number(arcLabel.getAttribute('y'))).toBeGreaterThanOrEqual(30);
    });

    it('separates circle segment labels from the center and from each other', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50, label: 'O' },
            radius: 30,
            points: [{ id: 'A', x: 80, y: 50 }, { id: 'B', x: 20, y: 50 }],
            radii: [{ to: 'A', label: '半径' }],
            diameters: [{ from: 'A', to: 'B', label: '直径' }],
        }));

        const diameter = svg?.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>直径<\/text>/);
        const radius = svg?.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>半径<\/text>/);
        const center = svg?.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>O<\/text>/);
        expect(diameter).not.toBeNull();
        expect(radius).not.toBeNull();
        expect(center).not.toBeNull();
        expect(Number(diameter![2])).toBeLessThan(250);
        expect(Number(radius![2])).toBeGreaterThan(250);
        expect(Number(center![2])).toBeGreaterThan(250);
        expect(`${diameter![1]},${diameter![2]}`).not.toBe(`${radius![1]},${radius![2]}`);
    });

    it('rejects circle points that are not on the circumference', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [{ id: 'A', x: 75, y: 50 }],
            radii: [{ to: 'A' }],
        }))).toBeNull();
    });

    it('rejects an unused circle point that is not on the circumference', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [{ id: 'A', x: 80, y: 50 }, { id: 'bad', x: 75, y: 50 }],
        }))).toBeNull();
    });

    it('rejects a diameter that does not pass through the circle center', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
            ],
            diameters: [{ from: 'A', to: 'B' }],
        }))).toBeNull();
    });

    it('rejects a circle that would cross the fixed SVG canvas boundary', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 10, y: 10 },
            radius: 45,
        }))).toBeNull();
    });

    it('renders stable area models for triangle, rectangle, parallelogram and trapezoid', () => {
        const specs = [
            { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: 0.35, baseLabel: '底6', heightLabel: '高4' },
            { type: 'area_geometry', shape: 'rectangle', width: 6, height: 4, baseLabel: '长6', heightLabel: '宽4' },
            { type: 'area_geometry', shape: 'square', width: 5, height: 5, baseLabel: '边长5' },
            { type: 'area_geometry', shape: 'parallelogram', width: 6, height: 4, offset: 1, baseLabel: '底6', heightLabel: '高4' },
            { type: 'area_geometry', shape: 'trapezoid', width: 8, height: 4, topWidth: 5, offset: 0.5, baseLabel: '下底8', topLabel: '上底5', heightLabel: '高4' },
        ];

        for (const spec of specs) {
            const svg = renderFigureSpec(JSON.stringify(spec));
            expect(svg).toContain('<svg');
            expect(svg).toContain('stroke-dasharray="7 5"');
            expect(svg).toContain(' L ');
            expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        }
    });

    it('rejects area models with contradictory shape parameters', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'area_geometry',
            shape: 'square',
            width: 5,
            height: 4,
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'area_geometry',
            shape: 'trapezoid',
            width: 5,
            height: 4,
            topWidth: 6,
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'area_geometry',
            shape: 'parallelogram',
            width: 5,
            height: 4,
            offset: 51,
        }))).toBeNull();
    });

    it('rejects circle figures whose declared diameter does not pass through the center', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 50, y: 20 },
            ],
            diameters: [{ from: 'A', to: 'B' }],
        }))).toBeNull();
    });

    it('rejects circle figures whose point is not on the declared circumference', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50 },
            radius: 30,
            points: [{ id: 'A', x: 75, y: 50 }],
            radii: [{ to: 'A' }],
        }))).toBeNull();
    });

    it('renders base extensions when parallelogram and trapezoid height feet leave the base', () => {
        for (const spec of [
            { type: 'area_geometry', shape: 'parallelogram', width: 6, height: 4, offset: 8 },
            { type: 'area_geometry', shape: 'trapezoid', width: 8, height: 4, topWidth: 5, offset: 8 },
        ]) {
            expect(parseFigureSpec(JSON.stringify(spec))).toMatchObject(spec);
            const svg = renderFigureSpec(JSON.stringify(spec));
            expect(svg).toContain('data-area-part="base-extension"');
            expect(svg).toContain('data-area-part="height"');
            expect(svg).toContain('data-area-part="right-angle"');
        }
    });

    it('renders stable solid geometry for cuboids and cubes', () => {
        const cuboid = renderFigureSpec(JSON.stringify({
            type: 'solid_geometry',
            shape: 'cuboid',
            width: 6,
            depth: 4,
            height: 5,
            widthLabel: '长6',
            depthLabel: '宽4',
            heightLabel: '高5',
        }));
        const cube = renderFigureSpec(JSON.stringify({
            type: 'solid_geometry',
            shape: 'cube',
            width: 4,
            depth: 4,
            height: 4,
            widthLabel: '棱长4',
        }));

        for (const svg of [cuboid, cube]) {
            expect(svg).toContain('<polygon');
            expect(svg).toContain('stroke-dasharray="7 5"');
            expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        }
        expect(cuboid).toContain('长6');
        expect(cuboid).toContain('宽4');
        expect(cuboid).toContain('高5');
        expect(cube).toContain('棱长4');

        const depthLabelY = Number(cuboid!.match(/<text x="[^"]+" y="([^"]+)"[^>]*>宽4<\/text>/)?.[1]);
        expect(depthLabelY).toBeGreaterThan(300);
    });

    it('renders only a foldable cube net with equal square faces', () => {
        const spec = {
            type: 'solid_net', shape: 'cube', title: '正方体展开图',
            cells: [
                { row: 0, col: 0, label: '1' }, { row: -1, col: 0, label: '2' },
                { row: 1, col: 0, label: '3' }, { row: 0, col: -1, label: '4' },
                { row: 0, col: 1, label: '5' }, { row: -2, col: 0, label: '6' },
            ],
        };
        expect(parseFigureSpec(JSON.stringify(spec))).not.toBeNull();
        const svg = renderFigureSpec(JSON.stringify(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const cells = Array.from(document.querySelectorAll('rect[data-figure-net-cell]'));
        expect(cells).toHaveLength(6);
        const size = Number(cells[0]!.getAttribute('width'));
        expect(size).toBeGreaterThanOrEqual(42);
        expect(cells.every((cell) => Number(cell.getAttribute('width')) === size && Number(cell.getAttribute('height')) === size)).toBe(true);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('rejects disconnected, duplicated or non-foldable six-square layouts', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'solid_net', shape: 'cube',
            cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }, { row: 2, col: 0 }],
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'solid_net', shape: 'cube',
            cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: -1, col: 0 }],
        }))).toBeNull();
        expect(parseFigureSpec(JSON.stringify({
            type: 'solid_net', shape: 'cube',
            cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
        }))).toBeNull();
    });

    it('rejects cubes whose three dimensions do not match', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'solid_geometry',
            shape: 'cube',
            width: 4,
            depth: 4,
            height: 5,
        }))).toBeNull();
    });

    it('rejects coordinate-plane points outside the declared ranges', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'coordinate_plane',
            xMin: 0,
            xMax: 5,
            yMin: 0,
            yMax: 5,
            points: [{ id: 'A', x: 6, y: 2 }],
        }))).toBeNull();
    });

    it('moves a right-edge coordinate label inward instead of clipping it', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'coordinate_plane',
            xMin: 0,
            xMax: 12,
            yMin: 0,
            yMax: 4,
            points: [{ id: 'A', x: 12, y: 2, label: '右边界点' }],
        }));

        expect(svg).toContain('>右边界点</text>');
        expect(svg).toMatch(/<text x="[0-9.]+" y="[0-9.]+" text-anchor="end"[^>]*>右边界点<\/text>/);
    });

    it('renders angle arcs and right-angle markers from stable point references', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'O', x: 50, y: 55, label: 'O' },
                { id: 'A', x: 20, y: 85, label: 'A' },
                { id: 'B', x: 80, y: 85, label: 'B' },
                { id: 'C', x: 50, y: 20, label: 'C' },
            ],
            segments: [
                { from: 'O', to: 'A' },
                { from: 'O', to: 'B' },
                { from: 'O', to: 'C' },
            ],
            angles: [
                { vertex: 'O', from: 'A', to: 'C', label: '角AOC' },
                { vertex: 'O', from: 'A', to: 'B', style: 'right', label: '直角' },
            ],
        }));

        expect(svg).toContain('角AOC');
        expect(svg).toMatch(/<path[^>]+A/);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);

        const rightAngleLabelY = Number(svg!.match(/<text x="[^"]+" y="([^"]+)"[^>]*>直角<\/text>/)?.[1]);
        expect(rightAngleLabelY).toBeGreaterThan(280);
    });

    it('rejects angle references to unknown or coincident points', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'O', x: 50, y: 50 }, { id: 'A', x: 80, y: 50 }],
            angles: [{ vertex: 'O', from: 'A', to: 'B' }],
        }))).toBeNull();

        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'O', x: 50, y: 50 }, { id: 'A', x: 80, y: 50 }],
            angles: [{ vertex: 'O', from: 'A', to: 'A' }],
        }))).toBeNull();
    });

    it('rejects a degenerate angle whose two rays overlap', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'O', x: 50, y: 50 },
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 90, y: 50 },
            ],
            angles: [{ vertex: 'O', from: 'A', to: 'B' }],
        }))).toBeNull();
    });

    it('does not draw a right-angle square for a non-perpendicular angle', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'O', x: 50, y: 50 },
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 75, y: 30 },
            ],
            angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right' }],
        }))).toBeNull();
    });

    it('does not accept a visibly oblique angle as a right angle', () => {
        expect(parseFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [
                { id: 'O', x: 50, y: 50 },
                { id: 'A', x: 80, y: 50 },
                { id: 'B', x: 55.21, y: 79.54 },
            ],
            angles: [{ vertex: 'O', from: 'A', to: 'B', style: 'right' }],
        }))).toBeNull();
    });

    it('exposes safe diagnostics without including raw question content', () => {
        expect(parseFigureSpecDetailed('')).toEqual({
            spec: null,
            diagnostic: { ok: false, reason: 'empty_input' },
        });
        expect(parseFigureSpecDetailed('{bad json')).toEqual({
            spec: null,
            diagnostic: { ok: false, reason: 'invalid_json' },
        });
        expect(renderFigureSpecDetailed(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'A', x: 10, y: 10 }],
            segments: [{ from: 'A', to: 'missing' }],
        })).diagnostic).toMatchObject({ ok: false, reason: 'schema_validation', type: 'basic_geometry' });
    });

    it('固定说明压住边界点时明确回退，而不是遮挡或移动说明', () => {
        const svg = renderFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'A', x: 100, y: 100 }],
            labels: [{ text: 'A', x: 100, y: 100 }],
        }));

        expect(svg).toBeNull();
    });

    it.each([
        { points: [{ id: 'A', x: 20, y: 50 }, { id: 'B', x: 80, y: 50 }], segments: [{ from: 'A', to: 'B' }], labels: [{ text: '固定说明', x: 50, y: 50 }] },
        { labels: [{ text: '说明甲', x: 50, y: 30 }, { text: '说明乙', x: 50, y: 30 }] },
        { points: [{ id: 'O', x: 50, y: 50 }], circles: [{ center: 'O', radius: 20 }], labels: [{ text: '圆周文字', x: 70, y: 50 }] },
    ])('固定说明遮挡线段、其它说明或圆周时回退', (description) => {
        const raw = JSON.stringify({ type: 'basic_geometry', ...description });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('固定说明保持原锚点和完整内容，不参与自由移动', () => {
        const svg = renderFigureSpec(JSON.stringify({ type: 'basic_geometry', labels: [{ text: '甲区域', x: 50, y: 30 }] }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const label = document.querySelector('text[data-figure-label="fixed"]')!;
        expect(label.textContent).toBe('甲区域');
        expect(label.getAttribute('x')).toBe(label.getAttribute('data-anchor-x'));
        expect(label.getAttribute('y')).toBe(label.getAttribute('data-anchor-y'));
    });

    it('小圆放不下圆名时返回明确诊断，不静默丢掉圆名', () => {
        const raw = JSON.stringify({ type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50 }], circles: [{ center: 'O', radius: 2, label: '圆O' }] });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it('小圆优先在圆心放置圆名，必要时缩小到可读的最小字号', () => {
        for (const radius of [5, 8, 11]) {
            const raw = JSON.stringify({ type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50 }], circles: [{ center: 'O', radius, label: '圆O' }] });
            const svg = renderFigureSpec(raw);
            expect(svg, `半径 ${radius} 的圆应保留圆名`).not.toBeNull();
            expect(svg).toContain('>圆O</text>');
            const text = new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelector('text')!;
            expect(Number(text.getAttribute('font-size'))).toBeGreaterThanOrEqual(12);
            expect(Number(text.getAttribute('font-size'))).toBeLessThanOrEqual(18);
        }
        const tooSmall = JSON.stringify({ type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50 }], circles: [{ center: 'O', radius: 4, label: '圆O' }] });
        expect(renderFigureSpec(tooSmall)).toBeNull();
    });

    it('几何点名低于最小可读字号时整图回退，不输出看似成功的细小文字', () => {
        const raw = JSON.stringify({
            type: 'coordinate_plane',
            xMin: 0, xMax: 4, yMin: 0, yMax: 4,
            points: [{ id: 'A', x: 1, y: 1, label: '这是一个过长的坐标点名称' }],
        });
        expect(parseFigureSpec(raw)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });
});

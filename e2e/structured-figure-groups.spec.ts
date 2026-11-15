import { test, expect } from './support/fixtures';
import { FIGURE_GROUP_FIXTURES } from '../src/__tests__/fixtures/figure-group-fixtures';
import { parseFigureSpec, renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureLabels } from './support/figure-label-checks';

const threeLineToken = 'W'.repeat(18) + '1';
const groupFixtures = [...FIGURE_GROUP_FIXTURES, {
    id: 'long-group-three-line-title',
    spec: { ...FIGURE_GROUP_FIXTURES[0].spec, title: Array.from({ length: 3 }, () => threeLineToken).join(' ') },
    unbrokenText: [threeLineToken],
}];

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 390 }]) {
    test(`多子图的顺序、比例、标注与像素（${viewport.name}）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await scenario.login(page);
        for (const fixture of groupFixtures) {
            const svg = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(svg).not.toBeNull();
            const item = await scenario.item(fixture.id, { questionText: `多子图回归 ${scenario.marker}`, figureSvg: svg });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            await expect(image).toHaveClass(/figure-readable-image/);
            const pixels = await image.evaluate(async (element) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                const source = decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1));
                const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
                return Array.from(svg.querySelectorAll('g[data-figure-panel]'), (panel) => {
                    const child = panel.querySelector('svg')!;
                    const [vx, vy, vw, vh] = child.getAttribute('viewBox')!.split(/\s+/).map(Number);
                    const x = Number(child.getAttribute('x'));
                    const y = Number(child.getAttribute('y'));
                    const width = Number(child.getAttribute('width'));
                    const height = Number(child.getAttribute('height'));
                    const data = context.getImageData(Math.floor(x), Math.floor(y), Math.floor(width), Math.floor(height)).data;
                    let nonWhite = 0;
                    for (let index = 0; index < data.length; index += 4) {
                        if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) nonWhite++;
                    }
                    const samples = [[440, 170], [440, 250], [360, 250], [360, 170]].map(([px, py]) =>
                        Array.from(context.getImageData(Math.floor(x + (px - vx) * width / vw), Math.floor(y + (py - vy) * height / vh), 1, 1).data));
                    return { nonWhite, samples };
                });
            });
            expect(pixels).toHaveLength(fixture.spec.figures.length);
            for (const panel of pixels) expect(panel.nonWhite).toBeGreaterThan(50);
            if (fixture.id === 'four-fractions') pixels.forEach((panel, index) => panel.samples.forEach((rgba, quadrant) => {
                if (quadrant <= index) expect(rgba[0]).toBeLessThan(245);
                else expect(rgba.slice(0, 3)).toEqual([255, 255, 255]);
            }));

            const metrics = await page.evaluate(async (markup) => {
                const source = new DOMParser().parseFromString(markup, 'image/svg+xml');
                const svg = document.importNode(source.documentElement, true) as unknown as SVGSVGElement;
                const host = document.createElement('div');
                host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
                host.append(svg);
                document.body.append(host);
                await document.fonts.ready;
                try {
                    const box = (element: Element) => {
                        const rect = element.getBoundingClientRect();
                        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
                    };
                    const root = box(svg);
                    const issues: string[] = [];
                    const within = (inner: ReturnType<typeof box>, outer: ReturnType<typeof box>) =>
                        inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5
                        && inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;
                    const panels = Array.from(svg.querySelectorAll<SVGGElement>('g[data-figure-panel]'));
                    const boxes = panels.map(box);
                    boxes.forEach((panel, index) => {
                        if (!within(panel, root)) issues.push(`子图${index}越界`);
                        boxes.slice(index + 1).forEach((other) => {
                            if (Math.min(panel.right, other.right) > Math.max(panel.left, other.left)
                                && Math.min(panel.bottom, other.bottom) > Math.max(panel.top, other.top)) issues.push(`子图${index}与其它子图重叠`);
                        });
                    });
                    for (const label of svg.querySelectorAll('text')) {
                        const owner = label.ownerSVGElement!;
                        if (!within(box(label), box(owner))) issues.push(`文字${label.textContent}越过所属画布`);
                    }
                    const heading = Array.from(svg.children).find((child) => child.tagName === 'text') as SVGTextElement | undefined;
                    const headingLines = heading ? Array.from(heading.querySelectorAll('tspan')) : [];
                    if (heading) {
                        if (panels.some((panel) => box(heading).bottom + 8 > box(panel.querySelector('text')!).top)) issues.push('图组标题与选项标签间距不足');
                        headingLines.forEach((line, index) => {
                            if (index > 0 && line.getBBox().y < headingLines[index - 1].getBBox().y + headingLines[index - 1].getBBox().height + 0.5) issues.push('图组标题行间距不足');
                        });
                    }
                    return {
                        issues,
                        heading: heading ? {
                            value: heading.textContent,
                            fontSize: Number(heading.getAttribute('font-size')),
                            lines: headingLines.length ? headingLines.map((line) => line.textContent ?? '') : [heading.textContent ?? ''],
                        } : null,
                        panels: panels.map((panel) => {
                            const child = panel.querySelector('svg')!;
                            const title = panel.querySelector('text')!;
                            const childBox = box(child);
                            if (box(title).bottom >= childBox.top) issues.push('选项标签与子图内容重叠');
                            const circle = Array.from(child.querySelectorAll('circle')).find((circle) => Number(circle.getAttribute('r')) > 7);
                            const circleTransform = circle?.getScreenCTM();
                            return {
                                label: panel.getAttribute('data-figure-option'), markup: child.outerHTML,
                                radius: circle && circleTransform ? circle.r.baseVal.value * Math.hypot(circleTransform.a, circleTransform.b) : null,
                                visibleRadius: circle ? circle.getBoundingClientRect().width / 2 : null,
                                minimumFont: Math.min(...Array.from(child.querySelectorAll('text'), (text) => {
                                    const transform = text.getScreenCTM()!;
                                    return Number(text.getAttribute('font-size')) * Math.hypot(transform.a, transform.b);
                                })),
                            };
                        }),
                    };
                } finally { host.remove(); }
            }, svg!);
            expect(metrics.issues, `${fixture.id} 排版`).toEqual([]);
            if (fixture.spec.title) {
                const parsed = parseFigureSpec(JSON.stringify(fixture.spec));
                if (parsed?.type !== 'figure_group') throw new Error('图组标题未正确解析');
                expect(metrics.heading?.value).toBe(parsed.title);
                expect(metrics.heading?.fontSize).toBe(22);
                expect(metrics.heading?.lines.length).toBeLessThanOrEqual(3);
                if (fixture.id.startsWith('long-group-')) expect(metrics.heading?.lines.length).toBeGreaterThan(1);
                if (fixture.id === 'long-group-three-line-title') expect(metrics.heading?.lines.length).toBe(3);
                for (const token of fixture.unbrokenText ?? []) expect(metrics.heading?.lines.some((line) => line.includes(token))).toBe(true);
            } else expect(metrics.heading).toBeNull();
            expect(metrics.panels.map((panel) => panel.label)).toEqual(fixture.spec.figures.map((entry) => entry.label));
            for (const panel of metrics.panels) {
                expect(panel.minimumFont).toBeGreaterThanOrEqual(12);
                if (panel.radius !== null) expect(Math.abs(panel.visibleRadius! - panel.radius)).toBeLessThan(0.01);
                // 每张子图分别检查，避免把不同 SVG 坐标系的点误当成同一张图。
                expect(await page.evaluate(inspectFigureLabels, { markup: panel.markup }), `${fixture.id} ${panel.label}`).toEqual([]);
            }
            if (fixture.id === 'four-circles') metrics.panels.forEach((panel, index) =>
                expect(panel.radius! / metrics.panels[0].radius!).toBeCloseTo([1, 1.5, 2, 2.5][index], 5));
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
            await page.locator('.figure-reading-region').screenshot({ path: testInfo.outputPath(`${fixture.id}-${viewport.name}.png`) });
            if (fixture.id === 'four-circles' || fixture.id === 'mixed-three-panels' || fixture.id === 'long-group-math-title') {
                await page.getByRole('button', { name: '查看大图', exact: true }).click();
                const viewer = page.getByRole('dialog');
                await expect(viewer.getByRole('img', { name: '题目配图', exact: true })).toBeVisible();
                await viewer.getByRole('button', { name: '放大', exact: true }).click();
                await viewer.screenshot({ path: testInfo.outputPath(`${fixture.id}-viewer-${viewport.name}.png`) });
                await page.keyboard.press('Escape');
            }
        }

        const smallCircleSvg = renderFigureSpec(JSON.stringify({
            type: 'basic_geometry',
            points: [{ id: 'O', x: 50, y: 50 }],
            circles: [{ center: 'O', radius: 5, label: '圆O' }],
        }));
        expect(smallCircleSvg).not.toBeNull();
        const smallCircle = await scenario.item(`small-labeled-circle-${viewport.name}`, {
            questionText: `小圆圆名回归 ${scenario.marker}`,
            figureSvg: smallCircleSvg,
        });
        await page.goto(`/error-items/${smallCircle.id}`);
        const smallCircleImage = page.getByRole('img', { name: '题目配图', exact: true });
        await expect(smallCircleImage).toBeVisible();
        const smallCircleMarkup = await smallCircleImage.getAttribute('src');
        const decodedSmallCircle = decodeURIComponent(smallCircleMarkup!.slice(smallCircleMarkup!.indexOf(',') + 1));
        const smallCircleMetrics = await page.evaluate((markup) => {
            const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
            const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
            const host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
            host.append(svg);
            document.body.append(host);
            try {
                const circle = svg.querySelector('circle[r]')!;
                const label = svg.querySelector<SVGTextElement>('text[data-figure-label="circle"]')!;
                const circleBox = circle.getBoundingClientRect();
                const labelBox = label.getBBox();
                const center = { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) };
                const corners = [labelBox.x, labelBox.x + labelBox.width].flatMap((x) => [labelBox.y, labelBox.y + labelBox.height].map((y) => ({ x, y })));
                const radius = Number(circle.getAttribute('r'));
                return {
                    fontSize: Number(label.getAttribute('font-size')),
                    text: label.textContent,
                    labelInsideCircle: corners.every((point) => Math.hypot(point.x - center.x, point.y - center.y) < radius),
                    renderedCircleWidth: circleBox.width,
                };
            } finally { host.remove(); }
        }, decodedSmallCircle);
        expect(smallCircleMetrics.text).toBe('圆O');
        expect(smallCircleMetrics.fontSize).toBeGreaterThanOrEqual(12);
        expect(smallCircleMetrics.labelInsideCircle).toBe(true);
        expect(smallCircleMetrics.renderedCircleWidth).toBeGreaterThan(0);
        expect(await page.evaluate(inspectFigureLabels, { markup: decodedSmallCircle })).toEqual([]);
        await smallCircleImage.screenshot({ path: testInfo.outputPath(`small-labeled-circle-${viewport.name}.png`) });
    });
}

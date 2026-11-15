import { test, expect } from './support/fixtures';
import { DIMENSION_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-dimension-fixtures';
import { parseFigureSpec, renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureLabels } from './support/figure-label-checks';

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 390 }]) {
    test(`面积与立体尺寸标注保留完整字形、归属和比例（${viewport.name}）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await scenario.login(page);
        for (const fixture of DIMENSION_FIGURE_FIXTURES) {
            const svg = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(svg, fixture.id).not.toBeNull();
            const item = await scenario.item(fixture.id, { questionText: `尺寸标注回归 ${scenario.marker}`, figureSvg: svg });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            const pixels = await image.evaluate(async (element) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let dark = 0;
                for (let index = 0; index < data.length; index += 4) {
                    if (data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100 && data[index + 3] > 0) dark++;
                }
                return { width: image.naturalWidth, height: image.naturalHeight, dark };
            });
            expect(pixels.width).toBeGreaterThan(0);
            expect(pixels.height).toBeGreaterThan(0);
            expect(pixels.dark).toBeGreaterThan(300);
            expect(await page.evaluate(inspectFigureLabels, { markup: svg! }), fixture.id).toEqual([]);
            const textMetrics = await page.evaluate(async (markup) => {
                const source = new DOMParser().parseFromString(markup, 'image/svg+xml');
                const svg = document.importNode(source.documentElement, true) as unknown as SVGSVGElement;
                const host = document.createElement('div');
                host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
                host.append(svg);
                document.body.append(host);
                try {
                    await document.fonts.ready;
                    const bounds = svg.viewBox.baseVal;
                    return Array.from(svg.querySelectorAll('text'), (text) => {
                        const box = text.getBBox();
                        const lines = Array.from(text.querySelectorAll('tspan'));
                        return {
                            value: text.textContent,
                            title: text.hasAttribute('data-figure-title'),
                            lines: lines.map((line) => line.textContent ?? ''),
                            clearLineSpacing: lines.every((line, index) => index === 0
                                || line.getBBox().y >= lines[index - 1].getBBox().y + lines[index - 1].getBBox().height + 0.5),
                            fontSize: Number(text.getAttribute('font-size')),
                            fits: box.x >= bounds.x && box.y >= bounds.y
                                && box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height,
                        };
                    });
                } finally { host.remove(); }
            }, svg!);
            for (const value of fixture.mustContain) expect(textMetrics.some((text) => text.value?.includes(value)), fixture.id).toBe(true);
            for (const text of textMetrics) {
                expect(text.fontSize, `${fixture.id}: ${text.value}`).toBeGreaterThanOrEqual(12);
                expect(text.fits, `${fixture.id}: ${text.value}`).toBe(true);
                expect(text.clearLineSpacing, `${fixture.id}: ${text.value}`).toBe(true);
                if (text.title) {
                    expect(text.lines.length).toBeLessThanOrEqual(3);
                    const parsed = parseFigureSpec(JSON.stringify(fixture.spec));
                    if (!parsed || !('title' in parsed)) throw new Error('标题未正确解析');
                    expect(text.value).toBe(parsed.title);
                    for (const token of fixture.unbrokenText ?? []) expect(text.lines.some((line) => line.includes(token))).toBe(true);
                }
            }
            if (fixture.id === 'dimension-rectangle-wide') {
                const reading = await image.evaluate((element, markup) => {
                    const image = element as HTMLImageElement;
                    const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
                    const style = getComputedStyle(image);
                    const contentWidth = image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
                    const contentHeight = image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
                    const scale = Math.min(contentWidth / svg.viewBox.baseVal.width, contentHeight / svg.viewBox.baseVal.height);
                    return {
                        width: svg.viewBox.baseVal.width,
                        minimumFont: Math.min(...Array.from(svg.querySelectorAll('text'), (text) => Number(text.getAttribute('font-size')))) * scale,
                    };
                }, svg!);
                expect(reading.width).toBeLessThan(420);
                expect(reading.minimumFont).toBeGreaterThanOrEqual(12);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            if (['dimension-rectangle-wide', 'dimension-trapezoid', 'dimension-cuboid'].includes(fixture.id)) {
                await testInfo.attach(`${fixture.id}-${viewport.name}`, { body: await image.screenshot(), contentType: 'image/png' });
            }
        }
        const group = renderFigureSpec(JSON.stringify({
            type: 'figure_group',
            figures: ['dimension-rectangle-wide', 'dimension-solid-math-title'].map((id, index) => ({
                label: 'AB'[index],
                figure: DIMENSION_FIGURE_FIXTURES.find((fixture) => fixture.id === id)!.spec,
            })),
        }));
        expect(group).not.toBeNull();
        const groupedItem = await scenario.item(`titled-group-${viewport.name}`, { questionText: `长标题图组回归 ${scenario.marker}`, figureSvg: group });
        await page.goto(`/error-items/${groupedItem.id}`);
        const groupedImage = page.getByRole('img', { name: '题目配图', exact: true });
        await expect(groupedImage).toBeVisible();
        const panels = await groupedImage.evaluate(async (element) => {
            const image = element as HTMLImageElement;
            await image.decode();
            const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
            return Array.from(svg.querySelectorAll('g[data-figure-panel] > svg'), (panel) => new XMLSerializer().serializeToString(panel));
        });
        expect(panels).toHaveLength(2);
        for (const panel of panels) expect(await page.evaluate(inspectFigureLabels, { markup: panel })).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await testInfo.attach(`titled-group-${viewport.name}`, { body: await groupedImage.screenshot(), contentType: 'image/png' });
    });
}

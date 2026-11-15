import { test, expect } from './support/fixtures';
import { HEADING_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-heading-fixtures';
import { parseFigureSpec, renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureHeadings } from './support/figure-heading-checks';
import { inspectFigureLabels } from './support/figure-label-checks';

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 390 }]) {
    test(`圆图与坐标图的独立标题完整显示且保留题图（${viewport.name}）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await scenario.login(page);
        for (const fixture of HEADING_FIGURE_FIXTURES) {
            const markup = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(markup, fixture.id).not.toBeNull();
            const item = await scenario.item(fixture.id, { questionText: `长标题回归 ${scenario.marker}`, figureSvg: markup });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            await expect(image).toHaveClass(/figure-readable-image/);
            const pixels = await image.evaluate(async (element, checks) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                const source = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
                const root = source.documentElement as unknown as SVGSVGElement;
                const body = root.querySelector<SVGSVGElement>('g[data-figure-body="true"] > svg')!;
                const style = getComputedStyle(image);
                const scale = Math.min(
                    (image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / root.viewBox.baseVal.width,
                    (image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / root.viewBox.baseVal.height,
                );
                const titleSize = Number(root.querySelector('text[data-figure-title]')!.getAttribute('font-size'));
                const bodyX = Math.floor((body.x.baseVal.value - root.viewBox.baseVal.x) * canvas.width / root.viewBox.baseVal.width);
                const bodyY = Math.floor((body.y.baseVal.value - root.viewBox.baseVal.y) * canvas.height / root.viewBox.baseVal.height);
                const bodyWidth = Math.floor(body.width.baseVal.value * canvas.width / root.viewBox.baseVal.width);
                const bodyHeight = Math.floor(body.height.baseVal.value * canvas.height / root.viewBox.baseVal.height);
                const data = context.getImageData(bodyX, bodyY, bodyWidth, bodyHeight).data;
                let dark = 0;
                for (let index = 0; index < data.length; index += 4) if (data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100 && data[index + 3] > 0) dark++;
                return { dark, reading: { titleSize: titleSize * scale, scale }, samples: checks.map((check) => {
                    const x = body.x.baseVal.value + (check.x - body.viewBox.baseVal.x) * body.width.baseVal.value / body.viewBox.baseVal.width;
                    const y = body.y.baseVal.value + (check.y - body.viewBox.baseVal.y) * body.height.baseVal.value / body.viewBox.baseVal.height;
                    const pixelX = Math.floor((x - root.viewBox.baseVal.x) * canvas.width / root.viewBox.baseVal.width);
                    const pixelY = Math.floor((y - root.viewBox.baseVal.y) * canvas.height / root.viewBox.baseVal.height);
                    if (pixelX < 0 || pixelX >= canvas.width || pixelY < 0 || pixelY >= canvas.height) throw new Error('题图采样点被裁切');
                    return { ...check, rgba: Array.from(context.getImageData(pixelX, pixelY, 1, 1).data) };
                }) };
            }, fixture.pixelChecks ?? []);
            expect(pixels.dark).toBeGreaterThan(100);
            expect(pixels.reading.titleSize, `${fixture.id} 页面标题字号`).toBeGreaterThanOrEqual(11.9);
            await testInfo.attach(`${fixture.id}-${viewport.name}-reading`, { body: JSON.stringify(pixels.reading), contentType: 'application/json' });
            for (const pixel of pixels.samples) {
                if (pixel.expectedRgba) expect(pixel.rgba).toEqual(pixel.expectedRgba);
                else if (pixel.fill === 'plain') expect(pixel.rgba.slice(0, 3)).toEqual([255, 255, 255]);
                else expect(pixel.rgba[0]).toBeLessThan(245);
            }
            const metrics = await page.evaluate(inspectFigureHeadings, markup!);
            expect(metrics.issues, fixture.id).toEqual([]);
            expect(metrics.bodies).toHaveLength(1);
            const body = metrics.bodies[0];
            const parsed = parseFigureSpec(JSON.stringify(fixture.spec));
            if (!parsed || !('title' in parsed)) throw new Error('标题未正确解析');
            expect(body.title).toBe(parsed.title);
            expect(body.lines.length).toBeGreaterThan(1);
            expect(body.lines.length).toBeLessThanOrEqual(3);
            expect(body.titleSize).toBeGreaterThanOrEqual(12);
            for (const token of fixture.unbrokenText ?? []) expect(body.lines.some((line) => line.includes(token))).toBe(true);
            expect(body.scale).toBeCloseTo(1, 10);
            expect(await page.evaluate(inspectFigureLabels, { markup: body.markup }), fixture.id).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            const region = page.locator('.figure-reading-region');
            await expect(region).toBeVisible();
            const scrolling = await region.evaluate((element) => {
                const image = element.querySelector('img')!;
                element.scrollLeft = element.scrollWidth;
                element.scrollTop = element.scrollHeight;
                const box = element.getBoundingClientRect();
                const picture = image.getBoundingClientRect();
                return { right: picture.right <= box.right + 1, bottom: picture.bottom <= box.bottom + 1, scrollWidth: element.scrollWidth, width: element.clientWidth };
            });
            expect(scrolling.right).toBe(true);
            expect(scrolling.bottom).toBe(true);
            if (fixture.id === 'heading-junior-coordinate-unit-square-landscape' && viewport.name === 'mobile') expect(scrolling.scrollWidth).toBeGreaterThan(scrolling.width);
            await region.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0; });
            await region.screenshot({ path: testInfo.outputPath(`${fixture.id}-${viewport.name}.png`) });
            if (fixture.id === 'heading-junior-title-coordinate') {
                const screen = (await image.boundingBox())!;
                await page.getByRole('spinbutton', { name: '配图显示比例', exact: true }).fill('50');
                await expect(image).toHaveCSS('zoom', '0.5');
                const half = (await image.boundingBox())!;
                expect(half.width / screen.width).toBeCloseTo(0.5, 2);
                expect(half.height / screen.height).toBeCloseTo(0.5, 2);
                await page.getByRole('spinbutton', { name: '配图显示比例', exact: true }).fill('100');
                await page.emulateMedia({ media: 'print' });
                await expect(region).toHaveCSS('overflow', 'visible');
                await expect(image).toHaveCSS('max-height', '360px');
                expect((await image.boundingBox())!.height).toBeLessThanOrEqual(361);
                await page.emulateMedia({ media: 'screen' });
                await expect(image).toHaveCSS('max-height', 'none');
                expect((await image.boundingBox())!.height).toBeCloseTo(screen.height, 1);
            }
        }

        const group = renderFigureSpec(JSON.stringify({ type: 'figure_group', figures: HEADING_FIGURE_FIXTURES.slice(0, 2).map((fixture, index) => ({ label: 'AB'[index], figure: fixture.spec })) }));
        expect(group).not.toBeNull();
        const groupedItem = await scenario.item(`heading-group-${viewport.name}`, { questionText: `长标题图组 ${scenario.marker}`, figureSvg: group });
        await page.goto(`/error-items/${groupedItem.id}`);
        const groupedImage = page.getByRole('img', { name: '题目配图', exact: true });
        await expect(groupedImage).toBeVisible();
        await expect(groupedImage).toHaveClass(/figure-readable-image/);
        await groupedImage.evaluate(async (element) => { await (element as HTMLImageElement).decode(); });
        const metrics = await page.evaluate(inspectFigureHeadings, group!);
        expect(metrics.issues).toEqual([]);
        expect(metrics.bodies).toHaveLength(2);
        for (const body of metrics.bodies) {
            expect(body.scale).toBeCloseTo(metrics.bodies[0].scale, 10);
            expect(await page.evaluate(inspectFigureLabels, { markup: body.markup })).toEqual([]);
        }
        await page.locator('.figure-reading-region').screenshot({ path: testInfo.outputPath(`heading-group-${viewport.name}.png`) });
        await page.getByRole('button', { name: '查看大图', exact: true }).click();
        const viewer = page.getByRole('dialog');
        const viewerImage = viewer.getByRole('img', { name: '题目配图', exact: true });
        await expect(viewerImage).toBeVisible();
        const before = await viewerImage.boundingBox();
        await viewer.getByRole('button', { name: '放大', exact: true }).click();
        expect((await viewerImage.boundingBox())!.width).toBeGreaterThan(before!.width);
        await viewer.screenshot({ path: testInfo.outputPath(`heading-group-viewer-${viewport.name}.png`) });
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 720 }, { name: 'mobile', width: 390, height: 667 }]) {
    test.describe(`配图阅读区操作（${viewport.name}）`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.name === 'mobile', isMobile: viewport.name === 'mobile' });

        test('完整图组可滚动阅读，底端可以避开固定导航', async ({ page, context, scenario }, testInfo) => {
            await scenario.login(page);
            const figure = HEADING_FIGURE_FIXTURES.find((fixture) => fixture.id === 'heading-junior-title-coordinate')!.spec;
            const markup = renderFigureSpec(JSON.stringify({
                type: 'figure_group', figures: Array.from({ length: 4 }, (_, index) => ({ label: 'ABCD'[index], figure })),
            }));
            expect(markup).not.toBeNull();
            const item = await scenario.item(`scrollable-heading-group-${viewport.name}`, { figureSvg: markup });
            await page.goto(`/error-items/${item.id}`);
            const region = page.getByRole('region', { name: '题目配图', exact: true });
            await expect(region).toBeVisible();
            const dimensions = await region.evaluate((element) => ({
                width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
            }));
            expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
            await region.focus();
            await page.keyboard.press('PageDown');
            await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

            if (viewport.name === 'mobile') {
                expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.width);
                await page.keyboard.press('ArrowRight');
                await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
                await region.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0; });
                await region.evaluate((element) => element.scrollIntoView({ block: 'start' }));
                const bounds = (await region.boundingBox())!;
                const touch = await context.newCDPSession(page);
                try {
                    const start = { x: Math.round(bounds.x + bounds.width * 0.8), y: Math.round(bounds.y + Math.min(bounds.height * 0.4, 150)) };
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...start }] });
                    for (let step = 1; step <= 6; step++) {
                        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: start.x - step * 25, y: start.y }] });
                    }
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(30);
                    const vertical = { x: Math.round(bounds.x + bounds.width * 0.5), y: Math.round(bounds.y + bounds.height * 0.7) };
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, ...vertical }] });
                    for (let step = 1; step <= 6; step++) {
                        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: vertical.x, y: vertical.y - step * 25 }] });
                    }
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(30);
                } finally { await touch.detach(); }
            }

            await region.evaluate((element) => {
                element.scrollLeft = element.scrollWidth;
                element.scrollTop = element.scrollHeight;
                element.scrollIntoView({ block: 'center' });
            });
            const access = await region.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const image = element.querySelector('img')!.getBoundingClientRect();
                const nav = document.querySelector('nav.fixed')?.getBoundingClientRect();
                const visibleBottom = nav && nav.height > 0 ? nav.top : window.innerHeight;
                return { right: image.right <= rect.right + 1, bottom: image.bottom <= rect.bottom + 1, clearOfNavigation: rect.bottom <= visibleBottom, top: rect.top };
            });
            expect(access.right).toBe(true);
            expect(access.bottom).toBe(true);
            expect(access.clearOfNavigation).toBe(true);
            expect(access.top).toBeGreaterThanOrEqual(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
            await page.screenshot({ path: testInfo.outputPath(`reading-bottom-right-${viewport.name}.png`) });
            expect((await scenario.model()).calls).toHaveLength(0);
        });
    });
}

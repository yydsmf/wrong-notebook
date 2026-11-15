import { test, expect } from './support/fixtures';
import { MATH_TEXT_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-math-text-fixtures';
import { STRUCTURED_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-spec-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';

const fixtures = [...MATH_TEXT_FIGURE_FIXTURES, ...STRUCTURED_FIGURE_FIXTURES.filter((fixture) => [
    'junior-coordinate-unit-square-portrait', 'junior-coordinate-unit-square-landscape',
].includes(fixture.id))];

for (const width of [1280, 390]) {
    test(`大图初始字号可读且完整内容可滚动访问（${width}px）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(180000);
        await page.setViewportSize({ width, height: width === 390 ? 667 : 900 });
        await scenario.login(page);
        for (const fixture of fixtures) {
            const svg = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(svg, fixture.id).not.toBeNull();
            const item = await scenario.item(fixture.id, { figureSvg: svg, figureScale: 50 });
            await page.goto(`/error-items/${item.id}`);
            const trigger = page.getByRole('button', { name: '查看大图', exact: true });
            await trigger.click();
            const dialog = page.getByRole('dialog');
            const image = dialog.getByRole('img', { name: '题目配图', exact: true });
            const region = dialog.getByRole('region', { name: '题目配图', exact: true });
            await expect(image).toHaveCSS('max-width', 'none');
            const metrics = await image.evaluate(async (element) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const source = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
                const svg = document.importNode(source.documentElement, true) as unknown as SVGSVGElement;
                svg.setAttribute('width', String(image.naturalWidth));
                svg.setAttribute('height', String(image.naturalHeight));
                const host = document.createElement('div');
                host.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;box-sizing:border-box;padding:12px;width:${image.parentElement!.clientWidth}px`;
                const control = image.cloneNode() as HTMLImageElement;
                // 对照修改前完整的适应样式，不把新阅读尺寸带入旧显示测量。
                control.style.cssText = 'max-height:calc(90dvh - 9rem);max-width:100%;width:auto;object-fit:contain';
                host.append(control, svg);
                document.body.append(host);
                try {
                    await control.decode();
                    await document.fonts.ready;
                    const fonts = Array.from(svg.querySelectorAll('text')).filter((text) => text.textContent?.trim()).map((text) => {
                        const matrix = text.getScreenCTM()!;
                        return parseFloat(getComputedStyle(text).fontSize) * Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
                    });
                    const intrinsic = Math.min(...fonts);
                    const factor = (element: HTMLImageElement) => {
                        const rect = element.getBoundingClientRect();
                        return Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
                    };
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const context = canvas.getContext('2d')!;
                    context.drawImage(image, 0, 0);
                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    let dark = 0;
                    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) dark++;
                    return { minimumFontSize: intrinsic * factor(image), baselineFontSize: intrinsic * factor(control), dark, texts: fonts.length,
                        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, renderedWidth: image.getBoundingClientRect().width };
                } finally { host.remove(); }
            });
            expect(metrics.dark).toBeGreaterThan(100);
            expect(metrics.texts).toBeGreaterThan(0);
            expect(metrics.minimumFontSize, `${fixture.id} 默认字号`).toBeGreaterThanOrEqual(11.9);
            expect(metrics.minimumFontSize).toBeGreaterThanOrEqual(metrics.baselineFontSize - 0.1);
            if (width === 390 && fixture.id.startsWith('math-text-')) {
                expect(metrics.baselineFontSize).toBeLessThan(11.9);
                expect(metrics.minimumFontSize / metrics.baselineFontSize).toBeGreaterThan(1.5);
            }
            await testInfo.attach(`${fixture.id}-reading-${width}`, { body: JSON.stringify(metrics), contentType: 'application/json' });
            const initial = (await image.boundingBox())!;
            await dialog.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}-initial.png`) });
            await dialog.getByRole('button', { name: '适应全图', exact: true }).click();
            await expect(image).toHaveCSS('max-width', '100%');
            const overview = (await image.boundingBox())!;
            const viewport = (await region.boundingBox())!;
            expect(overview.x).toBeGreaterThanOrEqual(viewport.x);
            expect(overview.y).toBeGreaterThanOrEqual(viewport.y);
            expect(overview.x + overview.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
            expect(overview.y + overview.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
            await dialog.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}-overview.png`) });
            await dialog.getByRole('button', { name: '放大', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(overview.width * 1.2);
            await dialog.getByRole('button', { name: '还原为 100%', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(overview.width, 1);
            await dialog.getByRole('button', { name: '阅读尺寸', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(initial.width, 1);
            await region.focus();
            await expect(region).toBeFocused();
            const dimensions = await region.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }));
            if (dimensions.scrollWidth > dimensions.width + 1) {
                await page.keyboard.press('ArrowRight');
                await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
            }
            if (dimensions.scrollHeight > dimensions.height + 1) {
                await page.keyboard.press('PageDown');
                await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
            }
            for (const [horizontal, vertical] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const corner = await region.evaluate((element, position) => {
                    element.scrollLeft = position.horizontal ? element.scrollWidth : 0;
                    element.scrollTop = position.vertical ? element.scrollHeight : 0;
                    const image = element.querySelector('img')!.getBoundingClientRect();
                    const rect = element.getBoundingClientRect();
                    const left = rect.left + element.clientLeft;
                    const top = rect.top + element.clientTop;
                    return { x: position.horizontal ? image.right : image.left, y: position.vertical ? image.bottom : image.top,
                        left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
                }, { horizontal, vertical });
                expect(corner.x).toBeGreaterThanOrEqual(corner.left - 1);
                expect(corner.x).toBeLessThanOrEqual(corner.right + 1);
                expect(corner.y).toBeGreaterThanOrEqual(corner.top - 1);
                expect(corner.y).toBeLessThanOrEqual(corner.bottom + 1);
            }
            await region.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0; });
            await dialog.getByRole('button', { name: '放大', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(initial.width * 1.2);
            await dialog.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}-zoomed.png`) });
            const reset = dialog.getByRole('button', { name: '还原为 100%', exact: true });
            await reset.click();
            await expect(reset).toHaveText('100%');
            await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(initial.width, 1);
            await page.keyboard.press('Escape');
            await expect(trigger).toBeFocused();
            await expect(page.getByRole('spinbutton', { name: '配图显示比例', exact: true })).toHaveValue('50');
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });

    test(`手动图片与无法测量的旧 SVG 保持全图显示和缩放（${width}px）`, async ({ page, scenario }, testInfo) => {
        await page.setViewportSize({ width, height: 667 });
        await scenario.login(page);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300" viewBox="0 0 800 300"><rect width="800" height="300" fill="white"/><text x="20" y="50" style="font-size:24px">旧配图</text></svg>';
        const png = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 300;
            const context = canvas.getContext('2d')!;
            context.fillStyle = 'white';
            context.fillRect(0, 0, 800, 300);
            context.fillStyle = 'black';
            context.fillRect(10, 10, 780, 2);
            return canvas.toDataURL('image/png');
        });
        for (const manual of [false, true]) {
            const item = await scenario.item(manual ? 'manual' : 'legacy', { figureSvg: legacy,
                imageFragments: manual ? JSON.stringify([{ id: 'manual', imageUrl: png, order: 0 }]) : null });
            await page.goto(`/error-items/${item.id}`);
            const trigger = page.getByRole('button', { name: '查看大图', exact: true });
            await trigger.click();
            const dialog = page.getByRole('dialog');
            const image = dialog.getByRole('img', { name: '题目配图', exact: true });
            await image.evaluate((element: HTMLImageElement) => element.decode());
            await expect(image).toHaveCSS('max-width', '100%');
            await expect(dialog.getByRole('button', { name: '适应全图', exact: true })).toHaveCount(0);
            if (manual) await expect(image).toHaveAttribute('src', png);
            const initial = (await image.boundingBox())!;
            expect(initial.width).toBeLessThanOrEqual(width - 24);
            expect(initial.width).toBeGreaterThan(100);
            await dialog.getByRole('button', { name: '放大', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(initial.width * 1.2);
            await dialog.getByRole('button', { name: '还原为 100%', exact: true }).click();
            await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(initial.width, 1);
            await dialog.screenshot({ path: testInfo.outputPath(`${manual ? 'manual' : 'legacy'}-${width}.png`) });
            await page.keyboard.press('Escape');
            await expect(trigger).toBeFocused();
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });
}

import { test, expect } from '@playwright/test';
import { EXTERIOR_ALTITUDE_FIXTURES } from '../src/__tests__/fixtures/figure-altitude-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureLabels } from './support/figure-label-checks';

for (const width of [1280, 390, 320]) {
    test(`外部高模板的图形、标注与虚线像素（${width}px）`, async ({ page }, testInfo) => {
        const requests: string[] = [];
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/*', async (route) => {
            requests.push(route.request().url());
            await route.abort();
        });
        for (const fixture of EXTERIOR_ALTITUDE_FIXTURES) {
            const markup = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(markup, fixture.id).not.toBeNull();
            await page.setContent(`<style>body{margin:16px;background:#f3f4f6}main{overflow:auto;max-width:100%;background:white}svg{display:block;max-width:100%;height:auto}</style><main>${markup}</main>`);
            expect(await page.evaluate(inspectFigureLabels, { markup: markup! }), fixture.id).toEqual([]);
            const metrics = await page.locator('svg').evaluate(async (element, expected) => {
                await document.fonts.ready;
                const root = element as SVGSVGElement;
                const view = root.viewBox.baseVal;
                const height = root.querySelector<SVGLineElement>('[data-area-part="height"] line')!;
                const extension = root.querySelector<SVGLineElement>('[data-area-part="base-extension"] line')!;
                const polygon = root.querySelector<SVGPolygonElement>('polygon')!;
                const baseStart = polygon.points.getItem(0);
                const baseEnd = polygon.points.getItem(1);
                const footRatio = (height.x1.baseVal.value - baseStart.x) / (baseEnd.x - baseStart.x);
                const issues: string[] = [];
                if (Math.abs(footRatio - expected.footRatio) > 0.0001) issues.push('外部垂足位置改变');
                if (Math.abs(height.x1.baseVal.value - height.x2.baseVal.value) > 0.001) issues.push('高不再垂直');
                if (Math.abs(extension.y1.baseVal.value - extension.y2.baseVal.value) > 0.001) issues.push('延长线偏离底边');
                const texts = Array.from(root.querySelectorAll('text'));
                for (const value of expected.mustContain) {
                    if (!texts.some((text) => text.textContent?.includes(value))) issues.push(`缺少原始文字：${value}`);
                }
                for (const shape of root.querySelectorAll<SVGGraphicsElement>('text,line,path,polygon')) {
                    const box = shape.getBBox();
                    if (box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width
                        || box.y + box.height > view.y + view.height) issues.push(`图文越界：${shape.tagName}`);
                }
                const displayScale = root.getBoundingClientRect().width / view.width;
                const fontSize = Math.min(...texts.map((text) => Number(getComputedStyle(text).fontSize.replace('px', '')) * displayScale));
                const host = document.querySelector('main')!;
                if (host.scrollWidth > host.clientWidth + 1) issues.push('手机初始适配裁掉图文');
                const image = new Image();
                image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('无法检查外部高的实际像素');
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const darkAt = (x: number, y: number) => {
                    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
                        const px = Math.floor(x - view.x) + dx;
                        const py = Math.floor(y - view.y) + dy;
                        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
                        const index = (py * canvas.width + px) * 4;
                        if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) return true;
                    }
                    return false;
                };
                const strokeSamples = [height, extension].map((line) => {
                    let dark = 0;
                    for (let index = 0; index < 80; index += 1) {
                        const t = 0.1 + index / 100;
                        if (darkAt(line.x1.baseVal.value + (line.x2.baseVal.value - line.x1.baseVal.value) * t,
                            line.y1.baseVal.value + (line.y2.baseVal.value - line.y1.baseVal.value) * t)) dark += 1;
                    }
                    return dark;
                });
                let darkPixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) darkPixels += 1;
                }
                return { issues, fontSize, strokeSamples, darkPixels, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
            }, { footRatio: fixture.footRatio, mustContain: fixture.mustContain });
            expect(metrics.issues, fixture.id).toEqual([]);
            expect(metrics.fontSize, fixture.id).toBeGreaterThanOrEqual(12);
            expect(metrics.darkPixels, fixture.id).toBeGreaterThan(300);
            for (const samples of metrics.strokeSamples) expect(samples, fixture.id).toBeGreaterThan(25);
            expect(metrics.pageWidth, fixture.id).toBeLessThanOrEqual(metrics.viewport + 1);
            await page.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`), fullPage: true });
        }
        expect(requests).toEqual([]);
    });
}

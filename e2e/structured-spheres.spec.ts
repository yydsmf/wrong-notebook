import { test, expect } from '@playwright/test';
import { SPHERE_FIXTURES } from '../src/__tests__/fixtures/figure-sphere-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureLabels } from './support/figure-label-checks';

for (const width of [1280, 390, 320]) {
    test(`球体的轮廓、赤道、尺寸线和移动端阅读（${width}px）`, async ({ page }, testInfo) => {
        const requests: string[] = [];
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/*', async (route) => {
            requests.push(route.request().url());
            await route.abort();
        });
        for (const fixture of SPHERE_FIXTURES) {
            const markup = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(markup, fixture.id).not.toBeNull();
            await page.setContent(`<style>body{margin:16px;background:#f3f4f6}main{overflow:auto;max-width:100%;background:white}svg{display:block;max-width:100%;height:auto}</style><main>${markup}</main>`);
            expect(await page.evaluate(inspectFigureLabels, { markup: markup! }), fixture.id).toEqual([]);
            const metrics = await page.locator('svg').evaluate(async (element, expected) => {
                await document.fonts.ready;
                const svg = element as SVGSVGElement;
                const view = svg.viewBox.baseVal;
                const issues: string[] = [];
                const shapes = Array.from(svg.querySelectorAll<SVGGraphicsElement>('text,line,path,circle'));
                for (const shape of shapes) {
                    const box = shape.getBBox();
                    if (box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width
                        || box.y + box.height > view.y + view.height) issues.push(`图文越界：${shape.tagName}`);
                }
                for (const value of [expected.radiusLabel, expected.diameterLabel, expected.title]) {
                    if (value && !svg.textContent?.includes(value)) issues.push(`缺少原始文字：${value}`);
                }
                const texts = Array.from(svg.querySelectorAll('text'));
                const displayScale = svg.getBoundingClientRect().width / view.width;
                const fontSize = Math.min(...texts.map((text) => parseFloat(getComputedStyle(text).fontSize) * displayScale));
                const outline = svg.querySelector<SVGCircleElement>('[data-sphere-part="outline"] circle');
                if (!outline || Number(outline.getAttribute('r')) !== 120) issues.push('球体轮廓半径不稳定');
                const radiusLine = svg.querySelector('[data-sphere-part="radius"] line');
                const diameterLine = svg.querySelector('[data-sphere-part="diameter"] line');
                const labeledSegments = Array.from(svg.querySelectorAll('text[data-from-x][data-to-x]'));
                for (const [label, line] of [[expected.radiusLabel, radiusLine], [expected.diameterLabel, diameterLine]] as const) {
                    if (!label) continue;
                    if (!line) issues.push(`缺少${label}尺寸线`);
                    if (!labeledSegments.some((text) => text.textContent === label)) issues.push(`缺少${label}尺寸线关联`);
                }
                const front = svg.querySelector('[data-sphere-part="equator-front"] path');
                const back = svg.querySelector('[data-sphere-part="equator-back"] path');
                if (!front || front.hasAttribute('stroke-dasharray') || !back?.getAttribute('stroke-dasharray')) issues.push('赤道前后弧虚实错误');
                const image = new Image();
                image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('无法检查球体实际像素');
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let darkPixels = 0;
                let bluePixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) darkPixels++;
                    if (pixels[index] < 230 && pixels[index + 1] > 225 && pixels[index + 2] > 245 && pixels[index + 3] > 0) bluePixels++;
                }
                const host = document.querySelector('main')!;
                if (host.scrollWidth > host.clientWidth + 1) issues.push('初始适配裁掉图文');
                return { issues, fontSize, darkPixels, bluePixels, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
            }, fixture.spec);
            expect(metrics.issues, fixture.id).toEqual([]);
            expect(metrics.fontSize, fixture.id).toBeGreaterThanOrEqual(12);
            expect(metrics.darkPixels, fixture.id).toBeGreaterThan(500);
            if (fixture.spec.fill === 'lightblue' || fixture.spec.fill === undefined) expect(metrics.bluePixels, fixture.id).toBeGreaterThan(1000);
            expect(metrics.pageWidth, fixture.id).toBeLessThanOrEqual(metrics.viewport + 1);
            await page.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`), fullPage: true });
        }
        expect(requests).toEqual([]);
    });
}

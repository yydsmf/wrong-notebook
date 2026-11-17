import { test, expect } from '@playwright/test';
import { ROUND_SOLID_FIXTURES } from '../src/__tests__/fixtures/figure-round-solid-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';
import { inspectFigureLabels } from './support/figure-label-checks';

for (const width of [1280, 390, 320]) {
    test(`圆柱圆锥的尺寸归属、相切轮廓和实际像素（${width}px）`, async ({ page }, testInfo) => {
        const requests: string[] = [];
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/*', async (route) => {
            requests.push(route.request().url());
            await route.abort();
        });
        for (const fixture of ROUND_SOLID_FIXTURES) {
            const markup = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(markup, fixture.id).not.toBeNull();
            await page.setContent(`<style>body{margin:16px;background:#f3f4f6}main{overflow:auto;max-width:100%;background:white}svg{display:block;max-width:100%;height:auto}</style><main>${markup}</main>`);
            expect(await page.evaluate(inspectFigureLabels, { markup: markup! }), fixture.id).toEqual([]);
            const metrics = await page.locator('svg').evaluate(async (element, expected) => {
                await document.fonts.ready;
                const svg = element as SVGSVGElement;
                const view = svg.viewBox.baseVal;
                const issues: string[] = [];
                const shapes = Array.from(svg.querySelectorAll<SVGGraphicsElement>('text,line,path,polygon,ellipse,circle'));
                for (const shape of shapes) {
                    const box = shape.getBBox();
                    if (box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width
                        || box.y + box.height > view.y + view.height) issues.push(`图文越界：${shape.tagName}`);
                }
                for (const value of [expected.radiusLabel, expected.diameterLabel, expected.heightLabel, expected.slantLabel, expected.title]) {
                    if (value && !svg.textContent?.includes(value)) issues.push(`缺少原始文字：${value}`);
                }
                const texts = Array.from(svg.querySelectorAll('text'));
                const displayScale = svg.getBoundingClientRect().width / view.width;
                const fontSize = Math.min(...texts.map((text) => parseFloat(getComputedStyle(text).fontSize) * displayScale));
                const image = new Image();
                image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('无法检查圆柱圆锥的实际像素');
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const colorAt = (x: number, y: number) => {
                    const index = (Math.floor(y - view.y) * canvas.width + Math.floor(x - view.x)) * 4;
                    return Array.from(pixels.slice(index, index + 4));
                };
                if (expected.shape === 'cylinder') {
                    const face = svg.querySelector<SVGPathElement>('[data-round-solid-part="top-face"] path')!.getBBox();
                    const topColor = expected.fill === 'gray' ? [243, 244, 246, 255] : expected.fill === 'none' ? [255, 255, 255, 255] : [239, 246, 255, 255];
                    for (const ratio of [0.3, 0.7]) {
                        if (JSON.stringify(colorAt(face.x + face.width * 0.6, face.y + face.height * ratio)) !== JSON.stringify(topColor)) issues.push('圆柱顶面填色不完整');
                    }
                }
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
                const arcs = ['base-front', 'base-back'].map((name) => svg.querySelector<SVGPathElement>(`[data-round-solid-part="${name}"] path`)!);
                const arcPixels = arcs.map((arc) => {
                    let dark = 0;
                    for (let index = 0; index < 80; index++) {
                        const at = arc.getPointAtLength(arc.getTotalLength() * (0.1 + index / 100));
                        if (darkAt(at.x, at.y)) dark++;
                    }
                    return dark;
                });
                if (arcs[0].hasAttribute('stroke-dasharray') || !arcs[1].hasAttribute('stroke-dasharray')) issues.push('前后底面弧的可见性错误');
                if (expected.shape === 'cone') {
                    const axis = svg.querySelector<SVGLineElement>('[data-round-solid-part="axis"] line')!;
                    const edge = svg.querySelector<SVGLineElement>('[data-round-solid-part="right-edge"] line')!;
                    if (axis.x1.baseVal.value !== axis.x2.baseVal.value || edge.x1.baseVal.value === edge.x2.baseVal.value) issues.push('圆锥高与母线混淆');
                }
                let darkPixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) darkPixels++;
                }
                const host = document.querySelector('main')!;
                if (host.scrollWidth > host.clientWidth + 1) issues.push('初始适配裁掉图文');
                return { issues, fontSize, arcPixels, darkPixels, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
            }, fixture.spec);
            expect(metrics.issues, fixture.id).toEqual([]);
            expect(metrics.fontSize, fixture.id).toBeGreaterThanOrEqual(12);
            expect(metrics.darkPixels, fixture.id).toBeGreaterThan(500);
            expect(metrics.arcPixels[0], fixture.id).toBeGreaterThan(65);
            expect(metrics.arcPixels[1], fixture.id).toBeGreaterThan(25);
            expect(metrics.arcPixels[1], fixture.id).toBeLessThan(80);
            expect(metrics.pageWidth, fixture.id).toBeLessThanOrEqual(metrics.viewport + 1);
            await page.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`), fullPage: true });
        }
        expect(requests).toEqual([]);
    });
}

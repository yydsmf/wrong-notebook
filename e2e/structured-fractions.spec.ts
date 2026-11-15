import { test, expect } from './support/fixtures';
import { MIXED_FRACTION_FIXTURES, mixedFractionSpec } from '../src/__tests__/fixtures/figure-fraction-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';

for (const width of [1280, 390]) {
    test(`带分数的完整单位、剩余分数与涂色一致（${width}px）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width, height: 900 });
        await scenario.login(page);
        for (const fixture of MIXED_FRACTION_FIXTURES) {
            const svg = renderFigureSpec(JSON.stringify(mixedFractionSpec(fixture)));
            expect(svg, fixture.id).not.toBeNull();
            const item = await scenario.item(fixture.id, { questionText: `带分数配图 ${scenario.marker}`, figureSvg: svg });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            await expect(image).toHaveClass(/figure-readable-image/);
            const checks = await image.evaluate(async (element, fixture) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                const documentSvg = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
                const inline = document.importNode(documentSvg.documentElement, true) as unknown as SVGSVGElement;
                const host = document.createElement('div');
                host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
                host.append(inline);
                document.body.append(host);
                await document.fonts.ready;
                try {
                    const issues: string[] = [];
                    const textElements = Array.from(inline.querySelectorAll('text'));
                    const bounds = inline.viewBox.baseVal;
                    const textBoxes = textElements.map((text) => text.getBBox());
                    for (const [index, box] of textBoxes.entries()) {
                        if (box.width <= 0 || box.height <= 0 || box.x < bounds.x || box.y < bounds.y
                            || box.x + box.width > bounds.width || box.y + box.height > bounds.height) issues.push('文字越界');
                        for (const other of textBoxes.slice(index + 1)) {
                            if (Math.min(box.x + box.width, other.x + other.width) > Math.max(box.x, other.x)
                                && Math.min(box.y + box.height, other.y + other.height) > Math.max(box.y, other.y)) issues.push('文字重叠');
                        }
                    }
                    const shapes = Array.from(inline.querySelectorAll<SVGGraphicsElement>(fixture.model === 'bar' ? 'rect[fill="none"]' : 'circle[fill="none"]'));
                    const samples = shapes.map((shape) => {
                        const box = shape.getBBox();
                        if (box.x < 0 || box.y < 0 || box.x + box.width > bounds.width || box.y + box.height > bounds.height) issues.push('图形越界');
                        for (const text of textBoxes) {
                            if (Math.min(box.x + box.width, text.x + text.width) > Math.max(box.x, text.x)
                                && Math.min(box.y + box.height, text.y + text.height) > Math.max(box.y, text.y)) issues.push('文字压住图形');
                        }
                        return { width: box.width, height: box.height, colors: Array.from({ length: fixture.parts }, (_, index) => (index + 0.5) / fixture.parts).map((position) => {
                            const angle = position * Math.PI * 2 - Math.PI / 2;
                            const x = fixture.model === 'bar' ? box.x + position * box.width : box.x + box.width / 2 + Math.cos(angle) * box.width * 0.3;
                            const y = fixture.model === 'bar' ? box.y + box.height * 0.37 : box.y + box.height / 2 + Math.sin(angle) * box.height * 0.3;
                            const data = context.getImageData(Math.floor(x * canvas.width / bounds.width), Math.floor(y * canvas.height / bounds.height), 1, 1).data;
                            return { position, rgba: Array.from(data) };
                        }) };
                    });
                    return { issues, samples, texts: textElements.map((text) => text.textContent) };
                } finally { host.remove(); }
            }, fixture);
            expect(checks.issues, fixture.id).toEqual([]);
            expect(checks.texts).toContain(`${fixture.whole} ${fixture.filled}/${fixture.parts}`);
            expect(checks.texts.filter((text) => text === '1')).toHaveLength(fixture.whole);
            expect(checks.samples).toHaveLength(fixture.whole + 1);
            for (const [index, sample] of checks.samples.entries()) {
                expect(sample.width).toBeCloseTo(checks.samples[0].width, 8);
                expect(sample.height).toBeCloseTo(checks.samples[0].height, 8);
                for (const color of sample.colors) {
                    const shaded = index < fixture.whole || color.position < fixture.filled / fixture.parts;
                    if (shaded) expect(color.rgba[0], `${fixture.id} 单位 ${index} 涂色`).toBeLessThan(245);
                    else expect(color.rgba).toEqual([255, 255, 255, 255]);
                }
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await page.getByRole('button', { name: '查看大图', exact: true }).click();
            const viewer = page.getByRole('dialog');
            await expect(viewer.getByRole('img', { name: '题目配图', exact: true })).toBeVisible();
            await viewer.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`) });
            await page.keyboard.press('Escape');
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });
}

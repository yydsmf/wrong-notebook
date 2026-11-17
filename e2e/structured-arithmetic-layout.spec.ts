import { test, expect } from '@playwright/test';
import { ARITHMETIC_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-arithmetic-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';

for (const width of [1280, 390, 320]) {
    test(`竖式模板字形与小数数位（${width}px）`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        const requests: string[] = [];
        await page.route('**/*', async (route) => {
            requests.push(route.request().url());
            await route.abort();
        });
        for (const fixture of ARITHMETIC_FIGURE_FIXTURES) {
            const markup = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(markup, fixture.id).not.toBeNull();
            for (const expected of fixture.mustContain) expect(markup).toContain(expected);
            await page.setContent(`<style>body{margin:16px;background:#f3f4f6}main{overflow:auto;max-width:100%;background:white}svg{display:block}</style><main>${markup}</main>`);
            const source = fixture.spec as { partialProducts: Array<{ shift?: number }> };
            const metrics = await page.locator('svg').evaluate(async (element, shifts) => {
                await document.fonts.ready;
                const root = element as SVGSVGElement;
                const view = root.viewBox.baseVal;
                const texts = Array.from(root.querySelectorAll('text'));
                const rows = texts.filter((text) => text.hasAttribute('data-arithmetic-row'));
                const issues: string[] = [];
                const center = (text: SVGTextElement, index: number) =>
                    (text.getStartPositionOfChar(index).x + text.getEndPositionOfChar(index).x) / 2;
                const top = rows.find((text) => text.getAttribute('data-arithmetic-row') === 'top')!;
                const lastColumn = center(top, top.getNumberOfChars() - 1);
                for (const row of rows) {
                    const characters = Array.from(row.textContent ?? '');
                    for (let index = 1; index < characters.length; index += 1) {
                        const gap = characters[index] === '.' || characters[index - 1] === '.' ? 15 : 30;
                        if (Math.abs(center(row, index) - center(row, index - 1) - gap) > 0.1) {
                            issues.push(`字符间距错误：${row.textContent} 第${index + 1}个字符`);
                        }
                    }
                    if (row.getAttribute('data-arithmetic-row') !== 'partial'
                        && Math.abs(center(row, row.getNumberOfChars() - 1) - lastColumn) > 0.1) {
                        issues.push(`末位数字未对齐：${row.textContent}`);
                    }
                }
                const partials = rows.filter((row) => row.getAttribute('data-arithmetic-row') === 'partial');
                if (partials.length !== shifts.length) issues.push('部分积行数不一致');
                partials.forEach((row, index) => {
                    if (Math.abs(lastColumn - center(row, row.getNumberOfChars() - 1) - shifts[index] * 30) > 0.1) {
                        issues.push(`部分积数位错误：${row.textContent}`);
                    }
                });
                const boxes = texts.map((text) => ({ text: text.textContent, box: text.getBBox() }));
                for (const [index, { box, text }] of boxes.entries()) {
                    if (box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width || box.y + box.height > view.y + view.height) {
                        issues.push(`文字越界：${text}`);
                    }
                    for (const other of boxes.slice(index + 1)) {
                        if (Math.min(box.x + box.width, other.box.x + other.box.width) > Math.max(box.x, other.box.x)
                            && Math.min(box.y + box.height, other.box.y + other.box.height) > Math.max(box.y, other.box.y)) {
                            issues.push(`文字重叠：${text}/${other.text}`);
                        }
                    }
                }
                const image = new Image();
                image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('无法读取竖式图像像素');
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let darkPixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) darkPixels += 1;
                }
                return { issues, darkPixels, pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
            }, source.partialProducts.map((partial, index) => partial.shift ?? index));
            expect(metrics.issues, fixture.id).toEqual([]);
            expect(metrics.darkPixels, fixture.id).toBeGreaterThan(500);
            expect(metrics.pageWidth, fixture.id).toBeLessThanOrEqual(metrics.viewport + 1);
            if (fixture.id.startsWith('multiplication-decimal-')) {
                await page.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`), fullPage: true });
            }
        }
        expect(requests).toEqual([]);
    });
}

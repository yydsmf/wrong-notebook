import { test, expect } from './support/fixtures';
import { MATH_TEXT_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-math-text-fixtures';
import { parseFigureSpec, renderFigureSpec } from '../src/lib/figure-spec';

for (const width of [1280, 390]) {
    test(`数学标注在方格、表格、图表和图组标题中完整显示（${width}px）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width, height: 900 });
        await scenario.login(page);
        for (const fixture of MATH_TEXT_FIGURE_FIXTURES) {
            const svg = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(svg, fixture.id).not.toBeNull();
            const normalizedSpec = parseFigureSpec(JSON.stringify(fixture.spec));
            expect(normalizedSpec, fixture.id).not.toBeNull();
            const displaySpec: Record<string, unknown> = { ...normalizedSpec };
            const item = await scenario.item(fixture.id, { questionText: `数学标注回归 ${scenario.marker}`, figureSvg: svg });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            await expect(image).toHaveClass(/figure-readable-image/);
            const issues = await image.evaluate(async (element, fixture) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let dark = 0;
                for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) dark++;
                const parsed = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
                const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
                const host = document.createElement('div');
                host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
                host.append(svg);
                document.body.append(host);
                await document.fonts.ready;
                try {
                    const issues: string[] = [];
                    if (dark < 100) issues.push('图形或文字像素为空');
                    const texts = Array.from(svg.querySelectorAll('text'));
                    for (const value of fixture.mustHaveText ?? []) if (!texts.some((text) => text.textContent === value)) issues.push(`文字缺失：${value}`);
                    for (const token of fixture.unbrokenText ?? []) {
                        if (!texts.some((text) => {
                            const lines = text.querySelectorAll('tspan');
                            return lines.length ? Array.from(lines).some((line) => line.textContent?.includes(token)) : text.textContent?.includes(token);
                        })) issues.push(`数学标记被拆行：${token}`);
                    }
                    for (const text of texts) {
                        const box = text.getBBox();
                        const bounds = text.ownerSVGElement!.viewBox.baseVal;
                        if (box.width <= 0 || box.height <= 0 || box.x < bounds.x - 0.5 || box.y < bounds.y - 0.5
                            || box.x + box.width > bounds.x + bounds.width + 0.5 || box.y + box.height > bounds.y + bounds.height + 0.5) issues.push(`文字越界：${text.textContent}`);
                    }
                    if (fixture.type === 'grid_shape') {
                        const cells = Array.from(svg.querySelectorAll<SVGRectElement>('rect[stroke="#111827"]'));
                        const columns = Number(fixture.spec.cols);
                        for (const label of fixture.spec.cellLabels as Array<{ row: number; col: number; text: string }>) {
                            const text = texts.find((text) => text.textContent === label.text)!;
                            const box = text.getBBox();
                            const cell = cells[label.row * columns + label.col].getBBox();
                            if (box.x < cell.x || box.y < cell.y || box.x + box.width > cell.x + cell.width || box.y + box.height > cell.y + cell.height) issues.push(`标注越格：${label.text}`);
                        }
                    }
                    if (fixture.type === 'table') {
                        const lines = Array.from(svg.querySelectorAll<SVGLineElement>('line'));
                        const xs = [...new Set(lines.filter((line) => line.x1.baseVal.value === line.x2.baseVal.value).map((line) => line.x1.baseVal.value))].sort((first, second) => first - second);
                        const ys = [...new Set(lines.filter((line) => line.y1.baseVal.value === line.y2.baseVal.value).map((line) => line.y1.baseVal.value))].sort((first, second) => first - second);
                        const rows = [fixture.spec.headers as string[], ...fixture.spec.rows as string[][]];
                        if (xs.length !== rows[0].length + 1 || ys.length !== rows.length + 1) issues.push('表格网格不完整');
                        else for (const [row, values] of rows.entries()) for (const [column, value] of values.entries()) {
                            const box = texts.find((text) => text.textContent === value)!.getBBox();
                            if (box.x < xs[column] || box.y < ys[row] || box.x + box.width > xs[column + 1] || box.y + box.height > ys[row + 1]) issues.push(`文字越过所属单元格：${value}`);
                        }
                    }
                    return issues;
                } finally { host.remove(); }
            }, { ...fixture, spec: displaySpec });
            expect(issues, fixture.id).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await page.getByRole('button', { name: '查看大图', exact: true }).click();
            const viewer = page.getByRole('dialog');
            const viewerImage = viewer.getByRole('img', { name: '题目配图', exact: true });
            await expect(viewerImage).toBeVisible();
            await viewer.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}.png`) });
            if (width === 390) {
                const initialWidth = (await viewerImage.boundingBox())!.width;
                for (let index = 0; index < 4; index++) await viewer.getByRole('button', { name: '放大', exact: true }).click();
                await expect.poll(async () => (await viewerImage.boundingBox())!.width).toBeGreaterThan(initialWidth * 2);
                await viewer.screenshot({ path: testInfo.outputPath(`${fixture.id}-${width}-zoomed.png`) });
            }
            await page.keyboard.press('Escape');
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });
}

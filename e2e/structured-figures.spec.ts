import { test, expect } from './support/fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';
import { STRUCTURED_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-spec-fixtures';
import { inspectFigureLabels } from './support/figure-label-checks';

test('标注检查器能检出固定说明和圆名的错误归属', async ({ page }) => {
    const wrap = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">${content}</svg>`;
    const fixed = '<text x="400" y="120" text-anchor="middle" font-size="18" data-figure-label="fixed" data-anchor-x="400" data-anchor-y="120">说明</text>';
    const circle = '<circle cx="400" cy="250" r="120" fill="none" stroke="#111"/>';
    const name = '<text x="400" y="210" text-anchor="middle" font-size="18" data-figure-label="circle" data-center-x="400" data-center-y="250" data-region-radius="120">圆甲</text>';
    expect(await page.evaluate(inspectFigureLabels, { markup: wrap(fixed + circle + name) })).toEqual([]);
    for (const [content, message] of [
        [fixed.replace('x="400"', 'x="420"'), '偏离原锚点'],
        [fixed + '<line x1="300" y1="115" x2="500" y2="115" stroke="#111"/>', '贴住 line'],
        [fixed + fixed.replace('说明</text>', '其它说明</text>'), '重叠'],
        [circle + name.replace('y="210"', 'y="90"'), '越过所属圆'],
        [name, '没有对应圆'],
        [circle + name + '<circle cx="400" cy="210" r="30" fill="none" stroke="#111"/>', '落入其它圆内部'],
    ]) {
        const issues = await page.evaluate(inspectFigureLabels, { markup: wrap(content) });
        expect(issues.some((issue) => issue.includes(message)), `${message} 应被实际字形检查检出`).toBe(true);
    }
});

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 390 }]) {
    test(`结构化 SVG 在浏览器中可加载且不造成横向溢出（${viewport.name}）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(Math.max(120000, STRUCTURED_FIGURE_FIXTURES.length * 6000));
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await scenario.login(page);

        const itemIds: string[] = [];
        try {
            for (const fixture of STRUCTURED_FIGURE_FIXTURES) {
                const svg = renderFigureSpec(JSON.stringify(fixture.spec));
                expect(svg, `${fixture.id} 应生成结构化 SVG`).not.toBeNull();
                const item = await scenario.item(fixture.id, {
                    questionText: `${fixture.stage}${fixture.type} 浏览器回归 ${scenario.marker}`,
                    figureSvg: svg,
                });
                itemIds.push(item.id);

                await page.goto(`/error-items/${item.id}`);
                const image = page.getByRole('img', { name: '题目配图', exact: true });
                await expect(image).toBeVisible();
                const metrics = await image.evaluate(async (element, pixelChecks) => {
                    const imageElement = element as HTMLImageElement;
                    await imageElement.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = imageElement.naturalWidth;
                    canvas.height = imageElement.naturalHeight;
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('浏览器无法创建像素检查画布');
                    context.drawImage(imageElement, 0, 0);
                    const source = imageElement.src.slice(imageElement.src.indexOf(',') + 1);
                    const svg = new DOMParser().parseFromString(decodeURIComponent(source), 'image/svg+xml').documentElement as unknown as SVGSVGElement;
                    const viewBox = svg.viewBox.baseVal;
                    return {
                        naturalWidth: imageElement.naturalWidth,
                        naturalHeight: imageElement.naturalHeight,
                        complete: imageElement.complete,
                        pixels: pixelChecks.map((point) => {
                            const x = Math.floor((point.x - viewBox.x) * imageElement.naturalWidth / viewBox.width);
                            const y = Math.floor((point.y - viewBox.y) * imageElement.naturalHeight / viewBox.height);
                            if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) throw new Error('涂色采样点被画布裁掉');
                            return { ...point, rgba: Array.from(context.getImageData(x, y, 1, 1).data) };
                        }),
                    };
                }, fixture.pixelChecks ?? []);
                expect(metrics.complete).toBe(true);
                expect(metrics.naturalWidth).toBeGreaterThan(0);
                expect(metrics.naturalHeight).toBeGreaterThan(0);
                for (const pixel of metrics.pixels) {
                    const expected = pixel.expectedRgba ?? (pixel.fill === 'shaded' ? [224, 237, 254, 255] : [255, 255, 255, 255]);
                    for (const [channel, value] of pixel.rgba.entries()) {
                        expect(Math.abs(value - expected[channel]), `${fixture.id} (${pixel.x}, ${pixel.y}) 涂色应为 ${pixel.fill}`).toBeLessThanOrEqual(3);
                    }
                }

                const table = fixture.type === 'table' ? fixture.spec as { headers: string[]; rows: string[][] } : null;
                const grid = fixture.type === 'grid_shape' ? fixture.spec as {
                    rows: number; cols: number; cellLabels: Array<{ row: number; col: number; text: string }>;
                } : null;
                const layoutProblems = await page.evaluate(async ({ markup, tableRows, expectedTexts, unbrokenText, checkCircleLabels, grid, figureType, arithmeticAlignment }) => {
                    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
                    if (parsed.querySelector('parsererror')) return ['SVG 文档解析失败'];
                    const inlineSvg = document.importNode(parsed.documentElement, true);
                    if (!(inlineSvg instanceof SVGSVGElement)) return ['根元素不是 SVG'];
                    const host = document.createElement('div');
                    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
                    inlineSvg.style.width = `${inlineSvg.viewBox.baseVal.width}px`;
                    inlineSvg.style.maxWidth = 'none';
                    host.append(inlineSvg);
                    document.body.append(host);
                    try {
                        await document.fonts.ready;
                        const issues: string[] = [];
                        const bounds = inlineSvg.viewBox.baseVal;
                        const texts = Array.from(inlineSvg.querySelectorAll('text'));
                        const geometry = ['basic_geometry', 'circle_geometry', 'coordinate_plane', 'number_line'].includes(figureType);
                        if (geometry) {
                            const shapes = Array.from(inlineSvg.querySelectorAll<SVGGraphicsElement>('line, path, circle, polygon, polyline'));
                            for (const shape of shapes) {
                                const box = shape.getBBox();
                                const padding = Number(shape.getAttribute('stroke-width') ?? 0) / 2;
                                if (box.x - padding < bounds.x - 0.5 || box.y - padding < bounds.y - 0.5
                                    || box.x + box.width + padding > bounds.x + bounds.width + 0.5
                                    || box.y + box.height + padding > bounds.y + bounds.height + 0.5) issues.push('收紧画布裁掉了题图图元或描边');
                            }
                        }
                        if (checkCircleLabels || figureType === 'number_line') {
                            for (const [index, first] of texts.entries()) {
                                const firstBox = first.getBBox();
                                for (const second of texts.slice(index + 1)) {
                                    const secondBox = second.getBBox();
                                    const width = Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) - Math.max(firstBox.x, secondBox.x);
                                    const height = Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) - Math.max(firstBox.y, secondBox.y);
                                    if (width > 0.5 && height > 0.5) issues.push(`图形标注重叠：“${first.textContent}”与“${second.textContent}”`);
                                }
                            }
                        }
                        const within = (element: SVGTextElement, left: number, top: number, right: number, bottom: number) => {
                            if (!element.textContent) return;
                            const box = element.getBBox();
                            if (box.width <= 0 || box.height <= 0
                                || box.x < left - 0.5 || box.y < top - 0.5
                                || box.x + box.width > right + 0.5 || box.y + box.height > bottom + 0.5) {
                                issues.push(`文字“${element.textContent}”越界：${JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height, left, top, right, bottom })}`);
                            }
                        };
                        for (const element of texts) within(element, bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
                        for (const value of expectedTexts) {
                            if (!texts.some((element) => element.textContent === value)) issues.push(`文字不完整：${value}`);
                        }
                        for (const token of unbrokenText) {
                            if (!texts.some((element) => {
                                const lines = element.querySelectorAll('tspan');
                                return lines.length ? Array.from(lines).some((line) => line.textContent?.includes(token)) : element.textContent?.includes(token);
                            })) issues.push(`数值或符号被拆行：${token}`);
                        }
                        if (arithmeticAlignment === 'decimal') {
                            const rows = texts.filter((element) => element.getAttribute('data-arithmetic-row') && element.textContent);
                            const centerOfChar = (element: SVGTextElement, index: number) => {
                                const start = element.getStartPositionOfChar(index);
                                const end = element.getEndPositionOfChar(index);
                                return (start.x + end.x) / 2;
                            };
                            const decimalRows = rows.filter((element) => element.textContent!.includes('.'));
                            const decimalPositions = decimalRows.map((element) => centerOfChar(element, element.textContent!.indexOf('.')));
                            if (decimalRows.length < 2 || decimalPositions.some((position) => !Number.isFinite(position))) {
                                issues.push('小数竖式缺少可测量的小数点字符');
                            } else {
                                const decimal = decimalPositions[0]!;
                                if (decimalPositions.some((position) => Math.abs(position - decimal) > 0.75)) issues.push('浏览器实际字形的小数点没有对齐');
                                const top = decimalRows[0]!;
                                const topSeparator = top.textContent!.indexOf('.');
                                const unit = centerOfChar(top, topSeparator - 1);
                                const integerRows = rows.filter((element) => !element.textContent!.includes('.'));
                                if (integerRows.some((element) => Math.abs(centerOfChar(element, element.textContent!.length - 1) - unit) > 0.75)) {
                                    issues.push('浏览器实际字形的整数个位没有对齐到小数点左侧');
                                }
                            }
                        }
                        if (grid) {
                            const cells = Array.from(inlineSvg.querySelectorAll<SVGRectElement>('rect[stroke="#111827"]'));
                            if (cells.length !== grid.rows * grid.cols) issues.push('方格行列数量不完整');
                            for (const cell of cells) {
                                const box = cell.getBBox();
                                if (Math.abs(box.width - box.height) > 0.01 || box.width < 20) issues.push('方格未保持正方形或尺寸过小');
                            }
                            for (const [index, label] of grid.cellLabels.entries()) {
                                const element = texts[index];
                                const cell = cells[label.row * grid.cols + label.col];
                                if (!cell || !element || element.textContent !== label.text) issues.push(`方格 ${label.row},${label.col} 文字不完整`);
                                else {
                                    const box = cell.getBBox();
                                    within(element, box.x + 2, box.y + 2, box.x + box.width - 2, box.y + box.height - 2);
                                    if (Number(element.getAttribute('font-size')) < 12) issues.push(`方格 ${label.row},${label.col} 字号过小`);
                                }
                            }
                        }
                        if (tableRows) {
                            const lines = Array.from(inlineSvg.querySelectorAll('line'));
                            const ys = [...new Set(lines.filter((element) => element.y1.baseVal.value === element.y2.baseVal.value)
                                .map((element) => element.y1.baseVal.value))].sort((first, second) => first - second);
                            const xs = [...new Set(lines.filter((element) => element.x1.baseVal.value === element.x2.baseVal.value)
                                .map((element) => element.x1.baseVal.value))].sort((first, second) => first - second);
                            if (ys.length !== tableRows.length + 1 || xs.length !== tableRows[0].length + 1) {
                                issues.push('表格网格未闭合');
                            } else {
                                const cells = texts.filter((element) => element.y.baseVal.getItem(0).value >= ys[0]);
                                let index = 0;
                                for (const [rowIndex, row] of tableRows.entries()) {
                                    for (const [colIndex, value] of row.entries()) {
                                        const element = cells[index++];
                                        if (!element || element.textContent !== value) issues.push(`单元格 ${rowIndex},${colIndex} 内容不完整`);
                                        else within(element, xs[colIndex], ys[rowIndex], xs[colIndex + 1], ys[rowIndex + 1]);
                                    }
                                }
                                if (cells.length !== index) issues.push('表格单元格数量不匹配');
                            }
                        }
                        return issues;
                    } finally {
                        host.remove();
                    }
                }, { markup: svg!, tableRows: table ? [table.headers, ...table.rows] : null, expectedTexts: fixture.mustHaveText ?? [], unbrokenText: fixture.unbrokenText ?? [], checkCircleLabels: fixture.type === 'circle_geometry', grid, figureType: fixture.type, arithmeticAlignment: fixture.arithmeticAlignment });
                expect(layoutProblems, `${fixture.id} 的文字应完整且位于画布及单元格内`).toEqual([]);
                const labelProblems = await page.evaluate(inspectFigureLabels, { markup: svg! });
                expect(labelProblems, `${fixture.id} 的几何标注应避开图元及其它文字并保留归属`).toEqual([]);

                if (['primary-table-narrow-chinese', 'primary-triangle-side-lengths', 'junior-circle-name-overlap', 'junior-title-coordinate', 'primary-vertical-decimal-addition'].includes(fixture.id)) {
                    const readability = await image.evaluate(async (element, markup) => {
                        const image = element as HTMLImageElement;
                        const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
                        const svg = parsed.documentElement as unknown as SVGSVGElement;
                        const viewBox = svg.viewBox.baseVal;
                        const minFont = Math.min(...Array.from(svg.querySelectorAll('text'), (text) => Number(text.getAttribute('font-size'))));
                        const factor = (target: HTMLImageElement, width: number, height: number) => {
                            const style = getComputedStyle(target);
                            return Math.min((target.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / width,
                                (target.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / height);
                        };
                        const current = minFont * factor(image, viewBox.width, viewBox.height);
                        const host = document.createElement('div');
                        host.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;width:${image.closest('figure')!.clientWidth}px`;
                        const control = image.cloneNode() as HTMLImageElement;
                        svg.setAttribute('width', '800');
                        svg.setAttribute('height', '500');
                        svg.setAttribute('viewBox', '0 0 800 500');
                        const background = svg.querySelector('rect')!;
                        for (const [name, value] of Object.entries({ x: '0', y: '0', width: '800', height: '500' })) background.setAttribute(name, value);
                        // 基线必须模拟未启用阅读放大的原始题图尺寸，不能继承当前图片的放大 width。
                        control.style.width = 'auto';
                        control.style.maxWidth = '100%';
                        control.style.maxHeight = '360px';
                        control.style.zoom = '1';
                        control.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
                        host.append(control);
                        document.body.append(host);
                        try {
                            await control.decode();
                            return { current, baseline: minFont * factor(control, 800, 500) };
                        } finally { host.remove(); }
                    }, svg!);
                    expect(readability.current, `${fixture.id} 的默认字号应达到可核对尺寸`).toBeGreaterThanOrEqual(fixture.type === 'coordinate_plane' ? 10 : 12);
                    if (viewport.name === 'mobile') expect(readability.current / readability.baseline, `${fixture.id} 应通过减少留白改善字号`).toBeGreaterThan(1.5);
                    await testInfo.attach(`${viewport.name}-${fixture.id}-readability`, { body: JSON.stringify(readability), contentType: 'application/json' });
                }

                if (['primary-table-narrow-chinese', 'primary-grid-dense-30', 'junior-circle-name-overlap', 'junior-title-coordinate'].includes(fixture.id)) {
                    const viewerButton = page.getByRole('button', { name: '查看大图', exact: true });
                    await expect(viewerButton).toBeVisible();
                    await viewerButton.click();
                    const viewerImage = page.getByRole('dialog').getByRole('img', { name: '题目配图', exact: true });
                    await expect(viewerImage).toBeVisible();
                    const viewerContainer = page.getByRole('dialog').locator('div.overflow-auto').first();
                    const initialViewerBox = await viewerImage.boundingBox();
                    for (let index = 0; index < (fixture.type === 'table' || fixture.type === 'grid_shape' ? 4 : 8); index += 1) {
                        await page.getByRole('button', { name: '放大', exact: true }).click();
                    }
                    await expect(page.getByRole('button', { name: '还原为 100%', exact: true })).toBeVisible();
                    const viewerBox = await viewerImage.boundingBox();
                    expect(viewerBox, `${fixture.id} 大图查看器应有可见图片`).not.toBeNull();
                    expect(initialViewerBox).not.toBeNull();
                    expect(viewerBox!.width).toBeGreaterThan(0);
                    expect(viewerBox!.height).toBeGreaterThan(0);
                    expect(viewerBox!.width).toBeGreaterThan(initialViewerBox!.width);
                    expect(await viewerContainer.evaluate((element) => element.scrollWidth)).toBeGreaterThan(await viewerContainer.evaluate((element) => element.clientWidth));
                    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
                    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-${fixture.id}-viewer-zoomed.png`), fullPage: true });
                    await page.keyboard.press('Escape');
                    await expect(page.getByRole('dialog')).toHaveCount(0);
                    await expect(viewerButton).toBeFocused();
                    expect(await page.getByRole('spinbutton', { name: '配图显示比例', exact: true }).inputValue()).toBe('100');
                }

                const box = await image.boundingBox();
                expect(box, `${fixture.id} 图片应有可见布局尺寸`).not.toBeNull();
                expect(box!.width).toBeGreaterThan(0);
                expect(box!.height).toBeGreaterThan(0);
                const readingRegion = image.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " figure-reading-region ")]');
                if (await readingRegion.count()) {
                    const regionBox = await readingRegion.boundingBox();
                    expect(regionBox, `${fixture.id} 阅读区域应有可见尺寸`).not.toBeNull();
                    expect(regionBox!.x + regionBox!.width, `${fixture.id} 阅读区域不应溢出页面`).toBeLessThanOrEqual(viewport.width + 1);
                    await readingRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
                    const endBox = await image.boundingBox();
                    expect(endBox!.x + endBox!.width, `${fixture.id} 完整图片右侧应可滚动访问`).toBeLessThanOrEqual(regionBox!.x + regionBox!.width + 1);
                    await readingRegion.evaluate((element) => { element.scrollLeft = 0; });
                } else {
                    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
                }
                const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
                expect(scrollWidth, `${fixture.id} 不应造成页面横向溢出`).toBeLessThanOrEqual(viewport.width + 1);

                await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-${fixture.id}.png`), fullPage: true });
            }
        } finally {
            await scenario.db.errorItem.deleteMany({ where: { id: { in: itemIds } } });
        }
    });
}

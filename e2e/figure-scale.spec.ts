import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';
import { STRUCTURED_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-spec-fixtures';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="none" stroke="black"/></svg>';

for (const width of [1280, 390]) {
    test(`配图比例保存、刷新和打印保持一致（${width}px）`, async ({ page, scenario }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width, height: 900 });
        await scenario.login(page);

        const suffix = randomUUID();
        const notebookResponse = await page.request.post('/api/notebooks', {
            data: { name: `配图比例测试-${suffix}`, stage: 'junior_high', subjectKey: 'biology' },
        });
        expect(notebookResponse.ok()).toBeTruthy();
        const notebook = await notebookResponse.json();
        const itemIds: string[] = [];
        try {
            const response = await page.request.post('/api/error-items', {
                data: { subjectId: notebook.id, questionText: `图示植物细胞的结构 ${suffix}`, gradeSemester: '初一上', figureSvg: svg, knowledgePoints: [] },
            });
            expect(response.status()).toBe(201);
            const item = await response.json();
            itemIds.push(item.id);
            // 录入接口停用自动 SVG；本用例使用已保存的配图验证比例与打印。
            expect(item.figureSvg).toBeNull();
            await scenario.db.errorItem.update({ where: { id: item.id }, data: { figureSvg: svg } });
            expect(item.figureScale).toBe(100);
            expect(item.figureAlign).toBe('center');
            await page.goto(`/error-items/${item.id}`);
            const input = page.getByRole('spinbutton', { name: '配图显示比例' });
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(input).toHaveValue('100');
            await image.evaluate((element: HTMLImageElement) => element.decode());
            const original = await image.boundingBox();
            expect(original).not.toBeNull();

            const slider = page.getByRole('slider', { name: '调整配图比例' });
            await slider.press('Home');
            await expect(input).toHaveValue('10');
            await slider.press('ArrowRight');
            await expect(input).toHaveValue('11');
            await input.fill('201');
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            await input.fill('');
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();

            await input.fill('50');
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '居右', exact: true }).click();
            await expect(image).toHaveCSS('zoom', '0.5');
            await expect(image.locator('..')).toHaveClass(/ml-auto/);
            const smaller = await image.boundingBox();
            expect(smaller!.width / original!.width).toBeCloseTo(0.5, 1);
            expect(smaller!.height / original!.height).toBeCloseTo(0.5, 1);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true }).click();
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            const savedItem = await (await page.request.get(`/api/error-items/${item.id}`)).json();
            expect(savedItem.figureScale).toBe(50);
            expect(savedItem.figureAlign).toBe('right');
            await page.reload();
            await expect(input).toHaveValue('50');
            await expect(image.locator('..')).toHaveClass(/ml-auto/);
            await page.screenshot({ path: testInfo.outputPath('detail-50-percent.png'), fullPage: true });

            // 未保存的调整可以取消，恢复 100% 也需保存后才写入数据库。
            await input.fill('150');
            const larger = await image.boundingBox();
            expect(larger!.width).toBeGreaterThan(original!.width);
            const bounds = await image.locator('..').boundingBox();
            expect(larger!.width).toBeLessThanOrEqual(bounds!.width + 1);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '取消', exact: true }).click();
            await expect(input).toHaveValue('50');

            // 请求失败时保留编辑值，并能重试保存。
            await page.route(`**/api/error-items/${item.id}`, async (route) => {
                if (route.request().method() === 'PUT') {
                    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '测试保存失败' }) });
                } else await route.continue();
            });
            await input.fill('65');
            const save = input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true });
            await save.click();
            await expect(page.getByText('保存失败', { exact: true })).toBeVisible();
            await expect(input).toHaveValue('65');
            await expect(save).toBeEnabled();
            await page.unroute(`**/api/error-items/${item.id}`);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '取消', exact: true }).click();

            // 打印文字时使用题目保存的比例与位置，在 print 媒体下实测尺寸。
            await page.goto(`/print-preview?subjectId=${notebook.id}`);
            await page.getByRole('checkbox', { name: '原题文字' }).check();
            await expect(image).toHaveCSS('zoom', '0.5');
            await expect(image.locator('..')).toHaveClass(/ml-auto/);
            await image.evaluate((element: HTMLImageElement) => element.decode());
            await page.emulateMedia({ media: 'print' });
            const printed = await image.boundingBox();
            expect(printed!.width).toBeCloseTo(smaller!.width, 0);
            expect(printed!.height).toBeCloseTo(smaller!.height, 0);
            await page.screenshot({ path: testInfo.outputPath('print-50-percent.png'), fullPage: true });
            await page.emulateMedia({ media: 'screen' });

            await page.goto(`/error-items/${item.id}`);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '恢复 100%' }).click();
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '居中', exact: true }).click();
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true }).click();
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            await page.reload();
            await expect(input).toHaveValue('100');
            await expect(image.locator('..')).toHaveClass(/mx-auto/);

            // 没有配图的题目不显示比例配置。
            const textResponse = await page.request.post('/api/error-items', {
                data: { subjectId: notebook.id, questionText: `没有图的血液循环文字题 ${randomUUID()}`, gradeSemester: '初一上', knowledgePoints: [] },
            });
            expect(textResponse.status()).toBe(201);
            const textItem = await textResponse.json();
            itemIds.push(textItem.id);
            await page.goto(`/error-items/${textItem.id}`);
            await expect(page.getByText('没有图的血液循环文字题', { exact: false })).toBeVisible();
            await expect(input).toHaveCount(0);
        } finally {
            for (const id of itemIds) {
                expect((await page.request.delete(`/api/error-items/${id}/delete`)).ok()).toBeTruthy();
            }
            expect((await page.request.delete(`/api/notebooks/${notebook.id}`)).ok()).toBeTruthy();
        }
    });

    test(`宽窄 SVG 与手动图片缩小为一半，并保持对齐（${width}px）`, async ({ page, scenario }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await scenario.login(page);
        for (const sourceWidth of [200, 800]) {
            const png = await page.evaluate((size) => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = 100;
                const context = canvas.getContext('2d')!;
                context.fillStyle = '#2563eb';
                context.fillRect(0, 0, size, 100);
                return canvas.toDataURL('image/png');
            }, sourceWidth);
            for (const kind of ['svg', 'manual']) {
                const item = await scenario.item(`scale-${sourceWidth}-${kind}`, {
                    figureSvg: kind === 'svg' ? svg.replace('width="200"', `width="${sourceWidth}"`).replace('0 0 200 100', `0 0 ${sourceWidth} 100`) : null,
                    imageFragments: kind === 'manual' ? JSON.stringify([{ id: 'manual', imageUrl: png, order: 0 }]) : null,
                });
                await page.goto(`/error-items/${item.id}`);
                const image = page.getByRole('img', { name: '题目配图', exact: true });
                await image.evaluate((element: HTMLImageElement) => element.decode());
                const initial = (await image.boundingBox())!;
                const input = page.getByRole('spinbutton', { name: '配图显示比例', exact: true });
                await input.fill('50');
                await expect(image).toHaveCSS('zoom', '0.5');
                const half = (await image.boundingBox())!;
                expect(half.width / initial.width).toBeCloseTo(0.5, 1);
                expect(half.height / initial.height).toBeCloseTo(0.5, 1);
                const area = (await image.locator('xpath=ancestor::figure').boundingBox())!;
                for (const alignment of ['居左', '居中', '居右']) {
                    await input.locator('xpath=ancestor::form').getByRole('button', { name: alignment, exact: true }).click();
                    const current = (await image.boundingBox())!;
                    const actual = alignment === '居左' ? current.x : alignment === '居右' ? current.x + current.width : current.x + current.width / 2;
                    const expected = alignment === '居左' ? area.x : alignment === '居右' ? area.x + area.width : area.x + area.width / 2;
                    expect(Math.abs(actual - expected)).toBeLessThan(2);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
                await page.screenshot({ path: testInfo.outputPath(`${kind}-${sourceWidth}-half-scale.png`) });
            }
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });
}

for (const width of [1280, 390]) {
    test.describe(`大图锚点和边缘阅读（${width}px）`, () => {
        test.use({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390 });

        test('纵向和横向结构化图缩放后仍能阅读四角，关闭后保留配图比例', async ({ page, context, scenario }, testInfo) => {
            await scenario.login(page);
            for (const id of ['junior-title-coordinate', 'junior-coordinate-unit-square-landscape']) {
                const fixture = STRUCTURED_FIGURE_FIXTURES.find((value) => value.id === id)!;
                const svg = renderFigureSpec(JSON.stringify(fixture.spec));
                expect(svg).not.toBeNull();
                const item = await scenario.item(id, { figureSvg: svg });
                await page.goto(`/error-items/${item.id}`);
                const trigger = page.getByRole('button', { name: '查看大图', exact: true });
                await trigger.click();
                const dialog = page.getByRole('dialog');
                const image = dialog.getByRole('img', { name: '题目配图', exact: true });
                const container = dialog.locator('div.overflow-auto').first();
                await image.evaluate((element: HTMLImageElement) => element.decode());
                const initial = (await image.boundingBox())!;
                const viewport = (await container.boundingBox())!;
                const center = {
                    x: Math.floor((Math.max(initial.x, viewport.x) + Math.min(initial.x + initial.width, viewport.x + viewport.width)) / 2),
                    y: Math.floor((Math.max(initial.y, viewport.y) + Math.min(initial.y + initial.height, viewport.y + viewport.height)) / 2),
                };
                const anchor = { x: (center.x - initial.x) / initial.width, y: (center.y - initial.y) / initial.height };
                if (width === 390) {
                    const touch = await context.newCDPSession(page);
                    try {
                        const points = (distance: number) => [-1, 1].map((direction, index) => ({ id: index, x: center.x + direction * distance, y: center.y }));
                        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(20) });
                        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100) });
                        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    } finally { await touch.detach(); }
                } else {
                    await page.mouse.move(center.x, center.y);
                    await page.mouse.wheel(0, -Math.log(5) / 0.0015);
                }
                const reset = dialog.getByRole('button', { name: '还原为 100%', exact: true });
                await expect(reset).toHaveText('500%');
                const enlarged = (await image.boundingBox())!;
                // 未产生溢出的方向无法任意平移，只在可滚动方向要求保留锚点。
                const visible = (await container.boundingBox())!;
                if (enlarged.width > visible.width) expect(Math.abs(enlarged.x + enlarged.width * anchor.x - center.x)).toBeLessThan(2);
                if (enlarged.height > visible.height) expect(Math.abs(enlarged.y + enlarged.height * anchor.y - center.y)).toBeLessThan(2);
                await page.screenshot({ path: testInfo.outputPath(`${id}-zoom-center.png`) });

                for (const [horizontal, vertical] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                    const corner = await container.evaluate((element, position) => {
                        element.scrollLeft = position.horizontal ? element.scrollWidth : 0;
                        element.scrollTop = position.vertical ? element.scrollHeight : 0;
                        const image = element.querySelector('img')!.getBoundingClientRect();
                        const rect = element.getBoundingClientRect();
                        const left = rect.left + element.clientLeft;
                        const top = rect.top + element.clientTop;
                        return {
                            x: position.horizontal ? image.right : image.left,
                            y: position.vertical ? image.bottom : image.top,
                            left, top, right: left + element.clientWidth, bottom: top + element.clientHeight,
                        };
                    }, { horizontal, vertical });
                    expect(corner.x).toBeGreaterThanOrEqual(corner.left - 1);
                    expect(corner.x).toBeLessThanOrEqual(corner.right + 1);
                    expect(corner.y).toBeGreaterThanOrEqual(corner.top - 1);
                    expect(corner.y).toBeLessThanOrEqual(corner.bottom + 1);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
                await reset.click();
                await expect(reset).toHaveText('100%');
                const restored = (await image.boundingBox())!;
                expect(restored.width).toBeCloseTo(initial.width, 1);
                expect(restored.height).toBeCloseTo(initial.height, 1);
                await dialog.getByRole('button', { name: '关闭', exact: true }).click();
                await expect(trigger).toBeFocused();
                await expect(page.getByRole('spinbutton', { name: '配图显示比例', exact: true })).toHaveValue('100');
            }
            expect((await scenario.model()).calls).toHaveLength(0);
        });
    });
}

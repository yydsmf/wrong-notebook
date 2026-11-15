import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures';
import { importImage } from './support/flows';
import { acceptConfirmDialog } from './helpers';

for (const entry of ['首页', '错题本'] as const) {
    test(`${entry}多图单题逐张裁剪，全部确认后只识别并保存一道题`, async ({ page, scenario }) => {
        await scenario.login(page);
        await page.goto(entry === '首页' ? `/?notebook=${scenario.book.id}` : `/notebooks/${scenario.book.id}/add`);
        const buffer = readFileSync(resolve('e2e/fixtures/math_test.png'));
        await page.locator('input[type="file"]').first().setInputFiles([
            { name: 'first.png', mimeType: 'image/png', buffer },
            { name: 'second.png', mimeType: 'image/png', buffer },
        ]);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('第 1 / 2 张图片', { exact: true })).toBeVisible();
        const firstImage = await dialog.locator('img').getAttribute('src');
        expect((await scenario.model()).calls.filter((call) => call.operation === 'analysis')).toHaveLength(0);

        await dialog.getByRole('button', { name: '确认并裁剪下一张', exact: true }).click();
        await expect(dialog.getByText('第 2 / 2 张图片', { exact: true })).toBeVisible();
        await expect(dialog.locator('img')).not.toHaveAttribute('src', firstImage!);
        expect((await scenario.model()).calls.filter((call) => call.operation === 'analysis')).toHaveLength(0);

        await dialog.getByRole('button', { name: '完成裁剪并导入', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await scenario.model()).calls.filter((call) => call.operation === 'analysis').length).toBe(1);
        await expect.poll(() => scenario.db.errorItem.count({ where: { subjectId: scenario.book.id } })).toBe(1);
        const item = await scenario.db.errorItem.findFirstOrThrow({ where: { subjectId: scenario.book.id } });
        expect(JSON.parse(item.originalImageUrls!)).toHaveLength(2);
    });
}

test('图片识别经人工校对后保存、刷新并删除', async ({ page, scenario }) => {
    const item = await importImage(page, scenario, true);
    await expect(page.getByText('校对后的方程', { exact: false })).toBeVisible();
    await expect(page.getByText('待复习', { exact: true }).first()).toBeVisible();
    expect(item.masteryLevel).toBe(0);
    await page.getByRole('button', { name: /^(删除|Delete)$/ }).click();
    await acceptConfirmDialog(page);
    await expect.poll(() => scenario.db.errorItem.count({ where: { id: item.id } })).toBe(0);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText('共 0 道错题')).toBeVisible();
    await page.getByRole('button', { name: /^(删除|Delete)$/ }).click();
    await acceptConfirmDialog(page);
    await page.waitForURL('**/notebooks');
    expect(await scenario.db.subject.findUnique({ where: { id: scenario.book.id } })).toBeNull();
});

for (const width of [1280, 390]) {
    for (const mode of ['单题裁剪', '多题框选']) {
        test(`旋转和放大后${mode}仍提交正确的原图区域（${width}px）`, async ({ page, scenario }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await scenario.login(page);
            await page.goto(`/?notebook=${scenario.book.id}`);
            const source = await page.evaluate(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 480;
                canvas.height = 360;
                const context = canvas.getContext('2d')!;
                for (const [index, color] of ['#dc2626', '#16a34a', '#2563eb', '#facc15'].entries()) {
                    context.fillStyle = color;
                    context.fillRect((index % 2) * 240, Math.floor(index / 2) * 180, 240, 180);
                }
                return canvas.toDataURL('image/png').split(',')[1];
            });
            await page.locator('input[type="file"]').first().setInputFiles({ name: 'crop-colors.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
            const dialog = page.getByRole('dialog');
            if (mode === '多题框选') await dialog.getByRole('button', { name: mode, exact: true }).click();
            const image = dialog.locator('img');
            await image.evaluate((element: HTMLImageElement) => element.decode());
            const originalSource = await image.getAttribute('src');
            await dialog.getByRole('button', { name: '向右旋转 90 度', exact: true }).click();
            await expect(image).not.toHaveAttribute('src', originalSource!);
            await image.evaluate((element: HTMLImageElement) => element.decode());
            expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([360, 480]);
            const previewPixels = await image.evaluate((element: HTMLImageElement) => {
                const canvas = document.createElement('canvas');
                canvas.width = element.naturalWidth;
                canvas.height = element.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(element, 0, 0);
                return [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) =>
                    Array.from(context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data));
            });
            for (const [index, color] of [[37, 99, 235, 255], [220, 38, 38, 255], [250, 204, 21, 255], [22, 163, 74, 255]].entries()) {
                for (let channel = 0; channel < 4; channel += 1) expect(Math.abs(previewPixels[index][channel] - color[channel])).toBeLessThanOrEqual(8);
            }
            if (mode === '单题裁剪') {
                const fit = (await image.boundingBox())!;
                const handle = dialog.locator('.ReactCrop__drag-handle.ord-nw');
                await handle.hover();
                await page.mouse.down();
                await page.mouse.move(fit.x + fit.width * 0.7, fit.y + fit.height * 0.7, { steps: 12 });
                await page.mouse.up();
            }
            for (let index = 0; index < 4; index += 1) await dialog.getByRole('button', { name: '放大', exact: true }).click();
            await expect(dialog.getByRole('button', { name: '还原为 100%', exact: true })).toHaveText('244%');
            const container = dialog.locator('div.overflow-auto');
            await container.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0; });
            const enlarged = (await image.boundingBox())!;
            if (mode === '多题框选') {
                await page.mouse.move(enlarged.x + enlarged.width * 0.1, enlarged.y + enlarged.height * 0.1);
                await page.mouse.down();
                await page.mouse.move(enlarged.x + enlarged.width * 0.3, enlarged.y + enlarged.height * 0.3, { steps: 12 });
                await page.mouse.up();
                await expect(dialog.getByRole('button', { name: '删除第 1 个框', exact: true })).toBeVisible();
            } else {
                const selection = (await dialog.locator('.ReactCrop__crop-selection').boundingBox())!;
                expect((selection.x - enlarged.x) / enlarged.width).toBeCloseTo(0.7, 2);
                expect((selection.y - enlarged.y) / enlarged.height).toBeCloseTo(0.7, 2);
                expect(selection.width / enlarged.width).toBeCloseTo(0.3, 2);
                expect(selection.height / enlarged.height).toBeCloseTo(0.3, 2);
            }
            await page.screenshot({ path: testInfo.outputPath('rotated-zoomed-crop.png') });
            const request = page.waitForRequest((value) => value.url().endsWith('/api/analyze') && value.method() === 'POST');
            await dialog.getByRole('button', { name: mode === '单题裁剪' ? '确认' : '导入 1 道题', exact: true }).click();
            const payload = (await request).postDataJSON();
            const dataUrl = payload.imageBase64 ?? payload.images[0];
            const cropped = await page.evaluate(async (src: string) => {
                const image = new Image();
                image.src = src;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                return { width: canvas.width, height: canvas.height, pixels: [0.2, 0.5, 0.8].map((fraction) => Array.from(context.getImageData(Math.floor(canvas.width * fraction), Math.floor(canvas.height * fraction), 1, 1).data)) };
            }, dataUrl);
            const fraction = mode === '单题裁剪' ? 0.3 : 0.2;
            expect(Math.abs(cropped.width - 360 * fraction)).toBeLessThanOrEqual(2);
            expect(Math.abs(cropped.height - 480 * fraction)).toBeLessThanOrEqual(2);
            const expectedColor = mode === '单题裁剪' ? [22, 163, 74, 255] : [37, 99, 235, 255];
            for (const pixel of cropped.pixels) for (let channel = 0; channel < 4; channel += 1) expect(Math.abs(pixel[channel] - expectedColor[channel])).toBeLessThanOrEqual(8);
            await expect.poll(() => scenario.db.errorItem.count({ where: { subjectId: scenario.book.id } })).toBe(1);
            expect((await scenario.model()).calls.filter((call) => call.operation === 'analysis')).toHaveLength(1);
        });
    }
}

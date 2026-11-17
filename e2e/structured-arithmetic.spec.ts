import { test, expect } from './support/fixtures';
import { ARITHMETIC_FIGURE_FIXTURES } from '../src/__tests__/fixtures/figure-arithmetic-fixtures';
import { renderFigureSpec } from '../src/lib/figure-spec';

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 390 }]) {
    test(`竖式配图保留作答空格与数位（${viewport.name}）`, async ({ page, scenario }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: 900 });
        await scenario.login(page);
        const grouped = {
            id: 'arithmetic-group',
            spec: { type: 'figure_group', figures: ARITHMETIC_FIGURE_FIXTURES.slice(0, 2).map(({ spec }, index) => ({ label: 'AB'[index], figure: spec })) },
            mustContain: ['>1□0</text>', '>□□□</text>'],
            initialVisible: false,
            mustHaveText: [] as string[],
        };
        for (const fixture of [...ARITHMETIC_FIGURE_FIXTURES, grouped]) {
            const svg = renderFigureSpec(JSON.stringify(fixture.spec));
            expect(svg).not.toBeNull();
            const item = await scenario.item(fixture.id, {
                questionText: `观察竖式并填写空格。${scenario.marker}`,
                figureSvg: svg,
            });
            await page.goto(`/error-items/${item.id}`);
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(image).toBeVisible();
            await expect(image).toHaveClass(/figure-readable-image/);
            const displayed = await image.evaluate(async (element) => {
                const image = element as HTMLImageElement;
                await image.decode();
                const markup = decodeURIComponent(image.currentSrc.slice(image.currentSrc.indexOf(',') + 1));
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('浏览器无法检查竖式图像');
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let darkPixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100 && pixels[index + 3] > 0) darkPixels += 1;
                }
                return { markup, width: image.naturalWidth, height: image.naturalHeight, darkPixels };
            });
            expect(displayed.width).toBeGreaterThan(0);
            expect(displayed.height).toBeGreaterThan(0);
            expect(displayed.darkPixels).toBeGreaterThan(500);
            for (const value of fixture.mustContain) expect(displayed.markup).toContain(value);
            if (!fixture.mustContain.includes('>850</text>')) expect(displayed.markup).not.toContain('>850</text>');
            if (!fixture.mustContain.includes('>170</text>')) expect(displayed.markup).not.toContain('>170</text>');
            const source: Record<string, unknown> = fixture.spec;
            const panels = source.type === 'figure_group'
                ? (source.figures as Array<{ figure: Record<string, unknown> }>).map(({ figure }) => figure)
                : [source];
            const expectedShifts = panels.map((panel) => (panel.partialProducts as Array<{ shift?: number }>).map((partial, index) => partial.shift ?? index));
            const problems = await image.evaluate(async (element, { markup, expectedShifts, initialVisible, expectedTexts }) => {
                const image = element as HTMLImageElement;
                const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
                if (parsed.querySelector('parsererror')) return ['竖式 SVG 解析失败'];
                const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
                root.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
                document.body.append(root);
                try {
                    await document.fonts.ready;
                    const issues: string[] = [];
                    const texts = Array.from(root.querySelectorAll('text'));
                    for (const expected of expectedTexts) {
                        if (!texts.some((text) => text.textContent === expected)) issues.push(`缺少完整说明：${expected}`);
                    }
                    for (const element of root.querySelectorAll('text')) {
                        const svg = element.ownerSVGElement!;
                        const box = element.getBBox();
                        const view = svg.viewBox.baseVal;
                        if (box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width || box.y + box.height > view.y + view.height) {
                            issues.push(`文字越界：${element.textContent}`);
                        }
                    }
                    const localFigures = [root, ...root.querySelectorAll('svg')].filter((svg) =>
                        Array.from(svg.children).some((element) => element.getAttribute('data-arithmetic-row') === 'top'));
                    if (localFigures.length !== expectedShifts.length) issues.push('竖式子图数量错误');
                    for (const [index, svg] of localFigures.entries()) {
                        const localTexts = texts.filter((text) => text.ownerSVGElement === svg);
                        const rows = localTexts.filter((text) => text.hasAttribute('data-arithmetic-row'));
                        const partials = rows.filter((text) => text.getAttribute('data-arithmetic-row') === 'partial');
                        const top = rows.find((text) => text.getAttribute('data-arithmetic-row') === 'top')!;
                        const center = (text: SVGTextElement, index: number) => (text.getStartPositionOfChar(index).x + text.getEndPositionOfChar(index).x) / 2;
                        const unit = center(top, top.getNumberOfChars() - 1);
                        if (partials.length !== expectedShifts[index].length) issues.push('部分积行数错误');
                        partials.forEach((text, partialIndex) => {
                            if (Math.abs(unit - center(text, text.getNumberOfChars() - 1) - expectedShifts[index][partialIndex] * 30) > 0.1) issues.push('实际字形的数位错开错误');
                        });
                        for (const text of rows) {
                            const characters = Array.from(text.textContent ?? '');
                            for (let position = 1; position < text.getNumberOfChars(); position += 1) {
                                const gap = characters[position] === '.' || characters[position - 1] === '.' ? 15 : 30;
                                if (Math.abs(center(text, position) - center(text, position - 1) - gap) > 0.1) issues.push('数字、方框或小数点的实际列间距错误');
                            }
                        }
                        const bottom = rows.find((text) => text.getAttribute('data-arithmetic-row') === 'bottom')!;
                        const result = rows.find((text) => text.getAttribute('data-arithmetic-row') === 'result');
                        if ([bottom, ...(result ? [result] : [])].some((text) => Math.abs(center(text, text.getNumberOfChars() - 1) - unit) > 0.1)) {
                            issues.push('因数或结果的末位数字没有对齐');
                        }
                        const boxes = localTexts.map((text) => ({ text, box: text.getBBox() }));
                        boxes.forEach(({ box, text }, index) => {
                            for (const other of boxes.slice(index + 1)) {
                                if (Math.min(box.x + box.width, other.box.x + other.box.width) > Math.max(box.x, other.box.x)
                                    && Math.min(box.y + box.height, other.box.y + other.box.height) > Math.max(box.y, other.box.y)) {
                                    issues.push(`竖式文字重叠：${text.textContent}/${other.text.textContent}`);
                                }
                            }
                        });
                    }
                    if (initialVisible) {
                        const region = image.closest('.figure-reading-region');
                        if (!region) return [...issues, '没有配图阅读区域'];
                        const clip = region.getBoundingClientRect();
                        const rect = image.getBoundingClientRect();
                        const css = getComputedStyle(image);
                        const zoom = rect.width / image.offsetWidth;
                        const leftInset = (parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)) * zoom;
                        const topInset = (parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop)) * zoom;
                        const horizontalInset = leftInset + (parseFloat(css.borderRightWidth) + parseFloat(css.paddingRight)) * zoom;
                        const scale = (rect.width - horizontalInset) / root.viewBox.baseVal.width;
                        for (const text of texts) {
                            const box = text.getBBox();
                            const x = rect.left + leftInset + (box.x - root.viewBox.baseVal.x) * scale;
                            const y = rect.top + topInset + (box.y - root.viewBox.baseVal.y) * scale;
                            if (x < clip.left - 1 || x + box.width * scale > clip.right + 1 || y < clip.top - 1 || y + box.height * scale > clip.bottom + 1) {
                                issues.push(`初始视图未显示完整文字：${text.textContent}`);
                            }
                        }
                    }
                    return issues;
                } finally { root.remove(); }
            }, { markup: displayed.markup, expectedShifts, initialVisible: fixture.initialVisible ?? false, expectedTexts: fixture.mustHaveText ?? [] });
            expect(problems).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${fixture.id}-${viewport.name}.png`), fullPage: true });
            await scenario.db.errorItem.delete({ where: { id: item.id } });
        }
        expect((await scenario.model()).calls).toHaveLength(0);
    });
}

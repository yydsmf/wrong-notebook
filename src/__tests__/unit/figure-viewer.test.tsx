import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigureViewer } from '@/components/figure-viewer';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { figureSvgToDataUri } from '@/lib/figure-svg';

const svg = (size = 12, attributes = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><text font-size="${size}" ${attributes}>长度为12.5 cm</text></svg>`;
let host: HTMLDivElement;
let root: Root;
const image = () => document.querySelector<HTMLImageElement>('[role="dialog"] img')!;
const show = async (markup?: string, src = markup ? figureSvgToDataUri(markup) : '/manual.png') => {
    await act(async () => root.render(<LanguageProvider><FigureViewer src={src} svg={markup} onClose={() => {}} onReturnFocus={() => {}} /></LanguageProvider>));
};
const load = async (width = 800, height = 500) => {
    const element = image();
    Object.defineProperties(element, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } });
    await act(async () => element.dispatchEvent(new Event('load')));
};

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

describe('大图弹窗默认阅读尺寸', () => {
    it('可测量 SVG 在 100% 下保留阅读宽度，滚动区域可聚焦，仍通过 img 隔离渲染', async () => {
        await show(svg());
        await load();
        expect(image().style.width).toBe('800px');
        expect(image().style.maxWidth).toBe('none');
        expect(image().style.maxHeight).toBe('none');
        const region = image().parentElement!;
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.getAttribute('aria-label')).toBe('题目配图');
        expect(document.querySelector('[role="dialog"] svg text')).toBeNull();
        await load();
        expect(image().style.width).toBe('800px');
    });

    it('小字号按已有规则放大到至少 12px，读取真实图片尺寸', async () => {
        await show(svg(8));
        await load();
        expect(image().style.width).toBe('1200px');
        await load(400, 250);
        expect(image().style.width).toBe('1200px');
    });

    it('可在全图概览和阅读尺寸之间切换，不改动图像来源', async () => {
        await show(svg());
        await load();
        const source = image().getAttribute('src');
        const fit = document.querySelector<HTMLButtonElement>('button[aria-label="适应全图"]');
        expect(fit).not.toBeNull();
        await act(async () => fit!.click());
        expect(image().style.width).toBe('auto');
        expect(image().style.maxWidth).toBe('100%');
        const reading = document.querySelector<HTMLButtonElement>('button[aria-label="阅读尺寸"]')!;
        await act(async () => reading.click());
        expect(image().style.width).toBe('800px');
        expect(image().getAttribute('src')).toBe(source);
    });

    it.each([undefined, svg(12, 'style="font-size:2px"'), svg(12, 'transform="scale(0.1)"'), svg(0.1)])('手动图片和无法可靠测量的旧 SVG 保持原来的全图显示：%s', async (markup) => {
        await show(markup);
        await load();
        expect(image().style.width).toBe('auto');
        expect(image().style.maxWidth).toBe('100%');
        expect(image().style.maxHeight).toBe('calc(90dvh - 9rem)');
        expect(document.querySelector('button[aria-label="适应全图"]')).toBeNull();
    });

    it('切换来源时不沿用上一张 SVG 的阅读宽度，图片未就绪时保持可恢复的全图显示', async () => {
        await show(svg());
        await load();
        expect(image().style.width).toBe('800px');
        await show();
        expect(image().style.width).toBe('auto');
        await load();
        expect(image().style.width).toBe('auto');
        await show(svg(8));
        await load(0, 0);
        expect(image().style.width).toBe('auto');
        await load();
        expect(image().style.width).toBe('1200px');
    });
});

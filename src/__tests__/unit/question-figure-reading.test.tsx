import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionFigure } from '@/components/question-figure';
import { LanguageProvider } from '@/contexts/LanguageContext';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="264" height="543" viewBox="0 0 264 543"><text font-size="12">坐标图长标题</text></svg>';
const expectedWidth = document.createElement('img').style;
expectedWidth.width = 'calc(264px + 1rem + 2px)';
let host: HTMLDivElement;
let root: Root;
const image = () => host.querySelector('img')!;
const show = async (markup: string | null, scale = 100, manual = false) => {
    await act(async () => root.render(
        <LanguageProvider><QuestionFigure svg={markup} scale={scale} images={manual ? [{ id: 'manual', imageUrl: '/manual.png', order: 0 }] : []} /></LanguageProvider>,
    ));
};
const load = async (width = 264, height = 543) => {
    const element = image();
    Object.defineProperties(element, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } });
    await act(async () => { element.dispatchEvent(new Event('load')); });
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

describe('配图加载后的可读尺寸', () => {
    it('加载后为长图保留完整尺寸，提供可聚焦滚动区域，并保持 img 隔离渲染', async () => {
        await show(svg);
        await load();
        const region = host.querySelector<HTMLElement>('.figure-reading-region')!;
        expect(region).not.toBeNull();
        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.getAttribute('aria-label')).toBe('题目配图');
        expect(image().style.width).toBe(expectedWidth.width);
        expect(image().style.maxHeight).toBe('none');
        expect(image().style.maxWidth).toBe('none');
        expect(image().style.zoom).toBe('1');
        expect(host.querySelector('svg text')).toBeNull();
        expect(host.textContent).not.toContain('坐标图长标题');
        await load();
        expect(host.querySelectorAll('.figure-reading-region')).toHaveLength(1);
    });

    it('用户调整比例时只缩放一次，切换为其它 SVG 时不沿用旧图尺寸', async () => {
        await show(svg);
        await load();
        await show(svg, 50);
        expect(image().style.width).toBe(expectedWidth.width);
        expect(image().style.zoom).toBe('0.5');
        expect(host.querySelector<HTMLElement>('figure > div')!.style.maxWidth).toBe('50%');
        await show('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><circle r="10"/></svg>');
        expect(image().style.maxHeight).toBe('360px');
        expect(host.querySelector('.figure-reading-region')).toBeNull();
        await load(800, 500);
        expect(host.querySelector('.figure-reading-region')).toBeNull();
    });

    it('手动配图优先显示，不继承 SVG 的阅读宽度，切换空题后仍可加载新图', async () => {
        await show(svg);
        await load();
        await show(svg, 100, true);
        expect(image().getAttribute('src')).toBe('/manual.png');
        expect(image().style.maxHeight).toBe('360px');
        expect(host.querySelector('.figure-reading-region')).toBeNull();
        await show(null);
        expect(host.querySelector('figure')).toBeNull();
        await show(svg);
        await load();
        expect(host.querySelector('.figure-reading-region')).not.toBeNull();
    });

    it('查看大图时传递对应的 SVG，不继承页面比例，也不把 SVG 尺寸用于手动配图', async () => {
        await show(svg, 50);
        await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="查看大图"]')!.click());
        const preview = document.querySelector<HTMLImageElement>('[role="dialog"] img')!;
        Object.defineProperties(preview, { naturalWidth: { configurable: true, value: 264 }, naturalHeight: { configurable: true, value: 543 } });
        await act(async () => preview.dispatchEvent(new Event('load')));
        expect(preview.style.width).toBe('264px');
        expect(preview.style.zoom).toBe('');
        await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭"]')!.click());
        await show(svg, 50, true);
        await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="查看大图"]')!.click());
        const manual = document.querySelector<HTMLImageElement>('[role="dialog"] img')!;
        Object.defineProperties(manual, { naturalWidth: { configurable: true, value: 264 }, naturalHeight: { configurable: true, value: 543 } });
        await act(async () => manual.dispatchEvent(new Event('load')));
        expect(manual.getAttribute('src')).toBe('/manual.png');
        expect(manual.style.width).toBe('auto');
    });
});

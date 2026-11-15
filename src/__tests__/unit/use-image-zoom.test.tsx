/**
 * 图片缩放：按钮、滚轮、双指捏合与还原
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, useImageZoom } from '@/lib/use-image-zoom';

type Zoom = ReturnType<typeof useImageZoom>;
const FIT = { maxHeight: '70vh', maxWidth: '100%' };

let root: Root;
let host: HTMLDivElement;
let zoom: Zoom;
let layout: { left: number; top: number; width: number; height: number; border: number; padding: number; fitWidth: number; fitHeight: number; centerY: boolean };

// 每次渲染后把 hook 的最新返回值交给测试
function Probe({ onRender }: { onRender: (value: Zoom) => void }) {
    const value = useImageZoom(FIT);
    const { containerRef, imageStyle } = value;
    useEffect(() => onRender(value));
    return (
        <div ref={containerRef} data-testid="scroll">
            <img alt="" style={imageStyle} />
        </div>
    );
}

const scrollEl = () => host.querySelector<HTMLDivElement>('[data-testid="scroll"]')!;
const imageEl = () => host.querySelector('img')!;

function mockLayout() {
    const container = scrollEl();
    const image = imageEl();
    const imageSize = () => {
        const width = Number.parseFloat(image.style.width) || layout.fitWidth;
        return { width, height: width * layout.fitHeight / layout.fitWidth };
    };
    const rectangle = (left: number, top: number, width: number, height: number) =>
        DOMRect.fromRect({ x: left, y: top, width, height });
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
        rectangle(layout.left, layout.top, layout.width + layout.border * 2, layout.height + layout.border * 2));
    for (const [name, dimension] of [['clientWidth', 'width'], ['clientHeight', 'height'], ['clientLeft', 'border'], ['clientTop', 'border']] as const) {
        vi.spyOn(container, name, 'get').mockImplementation(() => layout[dimension]);
    }
    vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() => {
        const { width, height } = imageSize();
        return rectangle(
            layout.left + layout.border + layout.padding + Math.max(0, (layout.width - 2 * layout.padding - width) / 2) - container.scrollLeft,
            layout.top + layout.border + layout.padding + (layout.centerY ? Math.max(0, (layout.height - 2 * layout.padding - height) / 2) : 0) - container.scrollTop,
            width, height,
        );
    });
    // 模拟浏览器滚动边界，不能靠 jsdom 允许的负滚动量掩盖锚点错误。
    for (const [name, dimension, viewport] of [['scrollLeft', 'width', 'width'], ['scrollTop', 'height', 'height']] as const) {
        let scroll = 0;
        Object.defineProperty(container, name, {
            configurable: true,
            get: () => scroll,
            set: (value: number) => { scroll = Math.max(0, Math.min(value, imageSize()[dimension] + layout.padding * 2 - layout[viewport])); },
        });
    }
}

function imagePoint(x: number, y: number) {
    const rect = imageEl().getBoundingClientRect();
    return { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
}

function wheelAt(target: number, point: { x: number; y: number }) {
    return new WheelEvent('wheel', {
        deltaY: -Math.log(target / zoom.zoom) / 0.0015,
        clientX: point.x, clientY: point.y, bubbles: true, cancelable: true,
    });
}

function expectPoint(x: number, y: number, expected: { x: number; y: number }) {
    const actual = imagePoint(x, y);
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
}

function touchEvent(type: string, points: Array<[number, number]>) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
    Object.defineProperty(event, 'touches', { value: touches });
    return event;
}

async function dispatch(event: Event) {
    await act(async () => { scrollEl().dispatchEvent(event); });
}

beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    layout = { left: 30, top: 20, width: 740, height: 600, border: 2, padding: 12, fitWidth: 400, fitHeight: 480, centerY: false };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<Probe onRender={(value) => { zoom = value; }} />); });
    mockLayout();
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useImageZoom', () => {
    it('初始为 100%，使用适应样式', () => {
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
    });

    it('放大按钮按 1.25 倍放大并按适应宽度换算图片宽度，缩小不低于 100%', async () => {
        await act(async () => zoom.zoomIn());
        expect(zoom.zoom).toBe(1.25);
        expect(zoom.imageStyle).toMatchObject({ width: 500, maxWidth: 'none', maxHeight: 'none' });

        await act(async () => zoom.zoomOut());
        await act(async () => zoom.zoomOut());
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
    });

    it('最多放大到 500%', async () => {
        for (let i = 0; i < 20; i++) await act(async () => zoom.zoomIn());
        expect(zoom.zoom).toBe(MAX_ZOOM);
    });

    it('滚轮向上放大、向下缩小，并阻止页面滚动', async () => {
        const up = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
        await dispatch(up);
        expect(up.defaultPrevented).toBe(true);
        expect(zoom.zoom).toBeGreaterThan(1);

        const before = zoom.zoom;
        await dispatch(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        expect(zoom.zoom).toBeLessThan(before);
    });

    it.each([350, 740])('居中窄图放大到 500%% 时保持图中锚点，兼容边框和内边距（%ipx）', async (width) => {
        layout.width = width;
        layout.fitWidth = 245.34375;
        const point = imagePoint(0.5, 0.5);
        await dispatch(wheelAt(5, point));
        expect(zoom.imageStyle.width).toBeCloseTo(layout.fitWidth * 5, 5);
        expectPoint(0.5, 0.5, point);
        expect(scrollEl().scrollLeft).toBeGreaterThan(0);
        expect(scrollEl().scrollTop).toBeGreaterThan(0);
        await dispatch(wheelAt(1, point));
        expect(zoom.zoom).toBe(1);
        expectPoint(0.5, 0.5, point);
    });

    it('以图片自身的非中心位置为锚点，并保留已有滚动量', async () => {
        const point = imagePoint(0.65, 0.4);
        await dispatch(wheelAt(3, point));
        expectPoint(0.65, 0.4, point);
        scrollEl().scrollLeft = 200;
        scrollEl().scrollTop = 160;
        const afterScroll = imagePoint(0.4, 0.3);
        await dispatch(wheelAt(4, afterScroll));
        expectPoint(0.4, 0.3, afterScroll);
        await dispatch(wheelAt(2, afterScroll));
        expectPoint(0.4, 0.3, afterScroll);
    });

    it('按钮使用当前可见图片区域的中心，兼容裁剪容器的双向居中', async () => {
        layout.centerY = true;
        const point = imagePoint(0.5, 0.5);
        await act(async () => zoom.zoomIn());
        expectPoint(0.5, 0.5, point);
        await dispatch(wheelAt(5, point));
        scrollEl().scrollLeft = 120;
        scrollEl().scrollTop = 300;
        const rect = imageEl().getBoundingClientRect();
        const center = { x: layout.left + layout.border + layout.width / 2, y: layout.top + layout.border + layout.height / 2 };
        const normalized = { x: (center.x - rect.left) / rect.width, y: (center.y - rect.top) / rect.height };
        await act(async () => zoom.zoomOut());
        expectPoint(normalized.x, normalized.y, center);
    });

    it('图片未解码或没有尺寸时不放大，加载后按实际尺寸重新测量', async () => {
        layout.fitWidth = 0;
        await act(async () => zoom.zoomIn());
        expect(zoom.zoom).toBe(1);
        layout.fitWidth = 310.5;
        await act(async () => zoom.zoomIn());
        expect(zoom.imageStyle.width).toBe(388.125);
    });

    it('双指在图中展开时保持捏合中心', async () => {
        layout.fitWidth = 245.34375;
        const point = imagePoint(0.5, 0.5);
        await dispatch(touchEvent('touchstart', [[point.x - 20, point.y], [point.x + 20, point.y]]));
        await dispatch(touchEvent('touchmove', [[point.x - 100, point.y], [point.x + 100, point.y]]));
        expect(zoom.zoom).toBe(5);
        expectPoint(0.5, 0.5, point);
        await dispatch(touchEvent('touchcancel', []));
    });

    it('双指张开放大，捏合期间拦截指针移动并阻止浏览器缩放', async () => {
        await dispatch(touchEvent('touchstart', [[100, 100], [200, 100]]));

        const pointerMove = new Event('pointermove', { bubbles: true });
        const childListener = vi.fn();
        host.querySelector('img')!.addEventListener('pointermove', childListener);
        await act(async () => { host.querySelector('img')!.dispatchEvent(pointerMove); });
        expect(childListener).not.toHaveBeenCalled();

        const move = touchEvent('touchmove', [[50, 100], [250, 100]]);
        await dispatch(move);
        expect(move.defaultPrevented).toBe(true);
        expect(zoom.zoom).toBeCloseTo(2);

        await dispatch(touchEvent('touchend', [[50, 100]]));
        await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('pointermove', { bubbles: true })); });
        expect(childListener).toHaveBeenCalledTimes(1);
    });

    it('还原回到 100%', async () => {
        await act(async () => zoom.zoomIn());
        await act(async () => zoom.reset());
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
        layout.fitWidth = 300.5;
        await act(async () => zoom.zoomIn());
        expect(zoom.imageStyle.width).toBe(375.625);
    });
});

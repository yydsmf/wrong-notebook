import { afterEach, describe, it, expect, vi } from 'vitest';
import { createRotatedImagePreview, mapRotatedRegionToSource, normalizeImageRotation, toSafeImageSrc } from '@/lib/image-crop';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('toSafeImageSrc', () => {
    it('接受本地文件生成的 blob 与 data 图片地址', () => {
        expect(toSafeImageSrc('blob:http://localhost:3000/0f1e2d3c')).toBe('blob:http://localhost:3000/0f1e2d3c');
        expect(toSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('拒绝脚本、HTML 和普通网络地址', () => {
        expect(toSafeImageSrc('javascript:alert(1)')).toBeUndefined();
        expect(toSafeImageSrc('data:text/html,<script>alert(1)</script>')).toBeUndefined();
        expect(toSafeImageSrc('https://example.com/a.png')).toBeUndefined();
        expect(toSafeImageSrc('')).toBeUndefined();
    });
});

describe('image rotation', () => {
    it('normalizes arbitrary quarter turns', () => {
        expect(normalizeImageRotation(-90)).toBe(270);
        expect(normalizeImageRotation(450)).toBe(90);
        expect(normalizeImageRotation(35)).toBe(0);
    });

    it('maps a rotated crop back to source coordinates', () => {
        const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
        expect(mapRotatedRegionToSource(region, 90)).toEqual({ x: 0.2, y: 0.6, width: 0.4, height: 0.3 });
        expect(mapRotatedRegionToSource(region, 180)).toEqual({ x: 0.6, y: 0.4, width: 0.3, height: 0.4 });
        expect(mapRotatedRegionToSource(region, 270)).toEqual({ x: 0.4, y: 0.1, width: 0.4, height: 0.3 });
    });

    it.each([90, 180, 270] as const)('旋转 %i 度后原图四角覆盖整个预览画布', async (rotation) => {
        vi.stubGlobal('Image', class {
            naturalWidth = 480;
            naturalHeight = 360;
            onload: (() => void) | null = null;
            set src(value: string) {
                if (value) queueMicrotask(() => this.onload?.());
            }
        });
        const createObjectURL = vi.fn(() => 'blob:rotated-preview');
        vi.stubGlobal('URL', { createObjectURL });
        let offsetX = 0;
        let offsetY = 0;
        let angle = 0;
        let corners: Array<{ x: number; y: number }> = [];
        const context = {
            fillRect: vi.fn(),
            translate: (x: number, y: number) => { offsetX = x; offsetY = y; },
            rotate: (radians: number) => { angle = radians; },
            drawImage: (_image: unknown, x: number, y: number, width: number, height: number) => {
                corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([cx, cy]) => ({
                    x: offsetX + cx * Math.cos(angle) - cy * Math.sin(angle),
                    y: offsetY + cx * Math.sin(angle) + cy * Math.cos(angle),
                }));
            },
        };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['preview'])));
        expect(await createRotatedImagePreview('data:image/png;base64,test', rotation)).toBe('blob:rotated-preview');
        expect(corners).toHaveLength(4);
        expect(Math.min(...corners.map((point) => point.x))).toBeCloseTo(0, 5);
        expect(Math.min(...corners.map((point) => point.y))).toBeCloseTo(0, 5);
        expect(Math.max(...corners.map((point) => point.x))).toBeCloseTo(rotation === 180 ? 480 : 360, 5);
        expect(Math.max(...corners.map((point) => point.y))).toBeCloseTo(rotation === 180 ? 360 : 480, 5);
        expect(createObjectURL).toHaveBeenCalledOnce();
    });
});

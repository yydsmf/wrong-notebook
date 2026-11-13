import { describe, it, expect } from 'vitest';
import { mapRotatedRegionToSource, normalizeImageRotation, toSafeImageSrc } from '@/lib/image-crop';

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
});

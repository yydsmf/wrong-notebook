import { describe, expect, it } from 'vitest';
import { getOriginalImages } from '@/lib/original-images';

describe('原题图片兼容', () => {
    it('优先返回完整的有序列表，不重复追加兼容首图', () => {
        expect(getOriginalImages({ originalImageUrl: 'a', originalImageUrls: '["a","b"]' })).toEqual(['a', 'b']);
    });
    it.each([undefined, null, 'invalid', '[]', '[42]', '{}'])('旧数据或无效列表 %s 回退到首图', originalImageUrls => {
        expect(getOriginalImages({ originalImageUrl: 'a', originalImageUrls })).toEqual(['a']);
    });
    it('无原图时保持空列表', () => {
        expect(getOriginalImages({})).toEqual([]);
    });
});

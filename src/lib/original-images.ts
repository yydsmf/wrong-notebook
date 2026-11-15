/** 原题的有序图片列表；旧数据没有列表时回退到单张原图。 */
export function getOriginalImages(item: { originalImageUrl?: string | null; originalImageUrls?: string | null }): string[] {
    if (item.originalImageUrls) {
        try {
            const images: unknown = JSON.parse(item.originalImageUrls);
            if (Array.isArray(images) && images.length > 0 && images.every(image => typeof image === 'string' && image.length > 0)) {
                return images;
            }
        } catch { /* 旧版或损坏的列表使用首图兜底。 */ }
    }
    return item.originalImageUrl ? [item.originalImageUrl] : [];
}

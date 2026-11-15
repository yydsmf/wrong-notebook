import { z } from 'zod';

export interface AIImageInput {
    base64: string;
    mimeType: string;
}

export const questionImagesSchema = z.array(z.string().min(1).max(20 * 1024 * 1024)).min(1).max(20)
    .refine(images => images.reduce((size, image) => size + image.length, 0) <= 50 * 1024 * 1024, 'Images exceed 50 MB');

/** 兼容旧接口的裸 base64；多图按传入顺序解析，不拼图或缩小图片。 */
export function parseImageInput(image: string, mimeType = 'image/jpeg'): AIImageInput {
    const match = image.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
    if (image.startsWith('data:') && !match) throw new Error('Invalid image data URL');
    return match ? { mimeType: match[1], base64: match[2] } : { mimeType, base64: image };
}

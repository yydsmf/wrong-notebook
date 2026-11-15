import { describe, expect, it } from 'vitest';
import { buildReanswerRequestBody } from '@/lib/reanswer-request';

describe('reanswer request body', () => {
    it('校对多图题时重新解答携带全部原图，顺序不变', () => {
        const images = ['data:image/png;base64,QQ==', 'data:image/jpeg;base64,Qg=='];
        const request = buildReanswerRequestBody({ questionText: '跨页题', language: 'zh', subject: '语文', imagePreviews: images, imagePreview: images[0] });
        expect(request).toMatchObject({ images });
        expect(request).not.toHaveProperty('imageBase64');
    });

    it('只有一张原图列表时沿用单图请求格式', () => {
        expect(buildReanswerRequestBody({ questionText: '题目', language: 'zh', subject: '数学', imagePreviews: ['data:image/png;base64,QQ=='] }))
            .toMatchObject({ imageBase64: 'data:image/png;base64,QQ==' });
    });
    it('重新解答只要有原图就应该带上原图，供错因分析使用', () => {
        const requestBody = buildReanswerRequestBody({
            questionText: '校正后的题目',
            language: 'zh',
            subject: '数学',
            imagePreview: 'data:image/jpeg;base64,abc',
        });

        expect(requestBody.imageBase64).toBe('data:image/jpeg;base64,abc');
    });

    it('没有原图时不传 imageBase64', () => {
        const requestBody = buildReanswerRequestBody({
            questionText: '校正后的题目',
            language: 'zh',
            subject: '数学',
        });

        expect(requestBody).not.toHaveProperty('imageBase64');
    });
});

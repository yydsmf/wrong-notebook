/**
 * /api/error-items/:id/figure 集成测试：用原题图片重绘 SVG 配图
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), update: vi.fn() },
    generateFigureSvg: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateFigureSvg: mocks.generateFigureSvg })) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: vi.fn().mockResolvedValue(null) }));

import { POST } from '@/app/api/error-items/[id]/figure/route';
import { parseFigure } from '@/lib/ai/schema';
import { listBackgroundTasks, resetBackgroundTasksForTest } from '@/lib/background-tasks';

const call = () => POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'e1' }) });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

describe('POST /api/error-items/:id/figure', () => {
    beforeEach(() => {
        resetBackgroundTasksForTest();
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', originalImageUrl: 'data:image/png;base64,QUJD', questionText: '如图，求三角形面积' });
        mocks.errorItem.update.mockImplementation(async ({ data }) => data);
    });
    afterEach(() => resetBackgroundTasksForTest());

    it('把原题图片和题干交给 AI，保存识别出的配图', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        const response = await call();

        expect(response.status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', '如图，求三角形面积');
        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: true, figureSvg: svg } }));
        expect(await response.json()).toEqual({ hasFigure: true, figureSvg: svg });
    });

    it.each([true, false])('没有可用配图时报告失败并保留已有图，而不是写入空图（hasFigure=%s）', async (hasFigure) => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure, figureSvg: null });

        const response = await call();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_FIGURE_GENERATED');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
        expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'failed', error: 'NO_FIGURE_GENERATED', canRetry: true })]);
    });

    it('结构化语义校验失败且无可用旧 SVG 时不覆盖旧图', async () => {
        const figure = parseFigure('true', null, JSON.stringify({
            type: 'area_geometry', shape: 'square', width: 40, height: 40,
            baseLabel: '5cm', heightLabel: '6cm',
        }));
        mocks.generateFigureSvg.mockResolvedValue(figure);

        const response = await call();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_FIGURE_GENERATED');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
        expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'failed', error: 'NO_FIGURE_GENERATED', canRetry: true })]);
    });

    it('结构化校验失败但有完整旧 SVG 回退时仍可保存', async () => {
        mocks.generateFigureSvg.mockResolvedValue(parseFigure('true', svg, JSON.stringify({
            type: 'area_geometry', shape: 'square', width: 40, height: 40,
            baseLabel: '5cm', heightLabel: '6cm',
        })));

        const response = await call();

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: true, figureSvg: svg } }));
    });

    it.each([null, svg])('声明后的问句仍核对形状，按有无完整旧图决定保存或失败：%s', async (legacy) => {
        const question = '下图是一个正方形，面积是多少？';
        mocks.errorItem.findUnique.mockResolvedValue({
            userId: 'user-1', originalImageUrl: 'data:image/png;base64,QUJD', questionText: question,
        });
        mocks.generateFigureSvg.mockResolvedValue(parseFigure('true', legacy, JSON.stringify({
            type: 'area_geometry', shape: 'triangle', width: 6, height: 4,
        }), question));

        const response = await call();

        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', question);
        if (legacy) {
            expect(response.status).toBe(200);
            expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: true, figureSvg: legacy } }));
        } else {
            expect(response.status).toBe(400);
            expect(mocks.errorItem.update).not.toHaveBeenCalled();
            expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'failed', canRetry: true })]);
        }
    });

    it.each([null, svg])('题首日期和公式样式不取消数字冲突的失败或完整旧图回退：%s', async (legacy) => {
        const question = '日期：2026-11-15。计算 $\\displaystyle34\\times25$。';
        mocks.errorItem.findUnique.mockResolvedValue({
            userId: 'user-1', originalImageUrl: 'data:image/png;base64,QUJD', questionText: question,
        });
        mocks.generateFigureSvg.mockResolvedValue(parseFigure('true', legacy, JSON.stringify({
            type: 'vertical_arithmetic', operation: '×', top: '43', bottom: '25',
        }), question));

        const response = await call();

        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', question);
        if (legacy) {
            expect(response.status).toBe(200);
            expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: true, figureSvg: legacy } }));
            expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'succeeded' })]);
        } else {
            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe('NO_FIGURE_GENERATED');
            expect(mocks.errorItem.update).not.toHaveBeenCalled();
            expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'failed', error: 'NO_FIGURE_GENERATED', canRetry: true })]);
        }
    });

    it('题首信息只用于内部比较，正确配图保存时不改写传给模型的完整题干', async () => {
        const question = '日期：2026-11-15。第1-3题选做。计算 $\\displaystyle34\\times25$。';
        const result = parseFigure('true', null, JSON.stringify({
            type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '25',
        }), question);
        expect(result.figureSvg).not.toBeNull();
        mocks.errorItem.findUnique.mockResolvedValue({
            userId: 'user-1', originalImageUrl: 'data:image/png;base64,QUJD', questionText: question,
        });
        mocks.generateFigureSvg.mockResolvedValue(result);

        const response = await call();

        expect(response.status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', question);
        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: result }));
        expect(listBackgroundTasks('user-1')).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    });

    it('未登录 401，他人题目 404，没有原图 400，均不调用 AI', async () => {
        mocks.session = null;
        expect((await call()).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findUnique.mockResolvedValueOnce({ userId: 'other', originalImageUrl: 'data:image/png;base64,QUJD', questionText: '' });
        expect((await call()).status).toBe(404);

        mocks.errorItem.findUnique.mockResolvedValueOnce({ userId: 'user-1', originalImageUrl: '', questionText: '文字题' });
        const noImage = await call();
        expect(noImage.status).toBe(400);
        expect((await noImage.json()).message).toBe('NO_ORIGINAL_IMAGE');

        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('AI 错误码透传给前端', async () => {
        mocks.generateFigureSvg.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));

        const response = await call();

        expect(response.status).toBe(500);
        expect((await response.json()).message).toBe('AI_TIMEOUT_ERROR');
    });
});

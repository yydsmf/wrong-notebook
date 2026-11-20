/**
 * 今日待复习 API 集成测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    errorItem: { findMany: vi.fn() },
    studentAnswer: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn(async () => ({ masteryThreshold: 50 })) },
    session: { user: { id: 'user-1', email: 'user@example.com', role: 'admin' }, expires: '2099-01-01' } as { user: { id: string; email: string; role: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { errorItem: mocks.errorItem, studentAnswer: mocks.studentAnswer, user: mocks.user } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

import { GET } from '@/app/api/review/due/route';

const get = (query = '') => GET(new Request(`http://localhost/api/review/due${query}`));

const candidates = [
    // 录入两天前、没有作答：昨天到期
    { id: 'new', createdAt: new Date('2026-10-18T02:00:00Z'), practiceRecords: [] },
    // 今天刚做对一次：两天后到期
    { id: 'fresh', createdAt: new Date('2026-10-01T02:00:00Z'), practiceRecords: [{ result: 'correct', createdAt: new Date('2026-10-20T01:00:00Z') }] },
    // 很早以前做错：早已到期，应排在最前
    { id: 'old', createdAt: new Date('2026-09-01T02:00:00Z'), practiceRecords: [{ result: 'wrong', createdAt: new Date('2026-09-10T02:00:00Z') }] },
];

describe('GET /api/review/due', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        // 北京时间 2026-10-20 12:00
        vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
        mocks.session = { user: { id: 'user-1', email: 'user@example.com', role: 'admin' }, expires: '2099-01-01' };
        mocks.user.findMany.mockResolvedValue([]);
        mocks.studentAnswer.findMany.mockResolvedValue([]);
        mocks.errorItem.findMany.mockImplementation(async (args: { where: { id?: { in: string[] } } }) => {
            if (!args.where.id) return candidates;
            return args.where.id.in.map((id) => ({ id, masteryProbability: null, subject: null, tags: [], _count: { practiceRecords: id === 'new' ? 0 : 1 } }));
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('只返回到期的错题，最早到期的在前，并附带复习计划', async () => {
        const response = await get();
        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data.total).toBe(2);
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['old', 'new']);
        expect(data.items[0]).toMatchObject({ reviewStage: 0, masteryStatus: 'reviewing', nextReviewAt: '2026-09-10T16:00:00.000Z' });
        expect(data.items[1]).toMatchObject({ reviewStage: 0, masteryStatus: 'new' });
        expect(mocks.errorItem.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-1' } }));
    });

    it('按错题本筛选并分页', async () => {
        const response = await get('?subjectId=math&page=2&pageSize=1');
        const data = await response.json();

        expect(mocks.errorItem.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-1', subjectId: 'math' } }));
        expect(data).toMatchObject({ total: 2, page: 2, pageSize: 1, totalPages: 2 });
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['new']);
    });

    it('未登录时返回 401', async () => {
        mocks.session = null;
        const response = await get();
        expect(response.status).toBe(401);
    });

    it('学生只使用自己的已判分记录计算共享题库复习计划', async () => {
        mocks.session = { user: { id: 'student-1', email: 'student@example.com', role: 'user' }, expires: '2099-01-01' };
        mocks.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
        mocks.studentAnswer.findMany.mockResolvedValue([
            { errorItemId: 'old', status: 'graded', isCorrect: true, createdAt: new Date('2026-10-19T02:00:00Z') },
        ]);

        const response = await get();
        expect(response.status).toBe(200);
        expect(mocks.studentAnswer.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                submission: { userId: 'student-1' },
                OR: [
                    { status: 'graded' },
                    { createdAt: { gte: new Date('2026-10-19T16:00:00Z'), lt: new Date('2026-10-20T16:00:00Z') } },
                ],
            }),
        }));
        expect((await response.json()).items.map((item: { id: string }) => item.id)).toContain('old');
    });

    it.each([
        { status: 'graded', isCorrect: true },
        { status: 'graded', isCorrect: false },
        { status: 'pending', isCorrect: null },
        { status: 'grading', isCorrect: null },
        { status: 'failed', isCorrect: null },
    ])('学生当天已提交的题不再返回：$status / $isCorrect', async ({ status, isCorrect }) => {
        mocks.session!.user.role = 'user';
        mocks.studentAnswer.findMany.mockResolvedValue([
            { errorItemId: 'old', status, isCorrect, createdAt: new Date('2026-10-20T02:00:00Z') },
        ]);

        const data = await (await get()).json();

        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['fresh', 'new']);
        expect(data.total).toBe(2);
    });

    it('答错的题当天不返回，应用时区跨日后以清零的档位返回', async () => {
        mocks.session!.user.role = 'user';
        mocks.studentAnswer.findMany.mockResolvedValue([
            { errorItemId: 'old', status: 'graded', isCorrect: true, createdAt: new Date('2026-10-15T02:00:00Z') },
            { errorItemId: 'old', status: 'graded', isCorrect: false, createdAt: new Date('2026-10-20T02:00:00Z') },
        ]);
        vi.setSystemTime(new Date('2026-10-20T15:59:59Z'));
        const today = await (await get()).json();
        expect(today.items.map((item: { id: string }) => item.id)).not.toContain('old');

        vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
        const tomorrow = await (await get()).json();
        expect(tomorrow.items).toContainEqual(expect.objectContaining({
            id: 'old', reviewStage: 0, nextReviewAt: '2026-10-20T16:00:00.000Z',
        }));
    });

    it('往日待批或失败记录不推进或重置已判分的连续答对计划', async () => {
        mocks.session!.user.role = 'user';
        mocks.studentAnswer.findMany.mockResolvedValue([
            { errorItemId: 'old', status: 'graded', isCorrect: true, createdAt: new Date('2026-10-17T02:00:00Z') },
            { errorItemId: 'old', status: 'graded', isCorrect: true, createdAt: new Date('2026-10-18T02:00:00Z') },
            { errorItemId: 'old', status: 'failed', isCorrect: null, createdAt: new Date('2026-10-19T02:00:00Z') },
            { errorItemId: 'old', status: 'pending', isCorrect: null, createdAt: new Date('2026-10-19T03:00:00Z') },
        ]);

        const data = await (await get()).json();
        expect(data.items.map((item: { id: string }) => item.id)).not.toContain('old');
    });

    it.each([
        { createdAt: '2026-10-19T15:59:59Z', due: true },
        { createdAt: '2026-10-19T16:00:00Z', due: false },
    ])('当天提交按应用时区而非 UTC 日期判断：$createdAt', async ({ createdAt, due }) => {
        mocks.session!.user.role = 'user';
        mocks.studentAnswer.findMany.mockResolvedValue([
            { errorItemId: 'old', status: 'graded', isCorrect: false, createdAt: new Date(createdAt) },
        ]);

        const data = await (await get()).json();
        expect(data.items.some((item: { id: string }) => item.id === 'old')).toBe(due);
    });
});

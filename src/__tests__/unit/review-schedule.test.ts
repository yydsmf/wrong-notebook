import { describe, expect, it } from 'vitest';
import { REVIEW_INTERVALS, getReviewPlan, getStudentReviewPlan, isReviewDue } from '@/lib/review-schedule';

const TZ = 'Asia/Shanghai';
// 北京时间 2026-10-01 20:00
const created = new Date('2026-10-01T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('getReviewPlan', () => {
    it('没有作答记录时，录入次日到期', () => {
        const plan = getReviewPlan(created, [], TZ);
        expect(plan.stage).toBe(0);
        // 北京时间 2026-10-02 零点
        expect(plan.nextReviewAt?.toISOString()).toBe('2026-10-01T16:00:00.000Z');
    });

    it('连续做对按间隔递增，以最近一次作答为起点', () => {
        const plan = getReviewPlan(created, [
            { result: 'correct', createdAt: at('2026-10-02T02:00:00Z') },
            { result: 'correct', createdAt: at('2026-10-04T02:00:00Z') },
        ], TZ);
        expect(plan.stage).toBe(2);
        // 2026-10-04 加 4 天，北京时间 10-08 零点
        expect(plan.nextReviewAt?.toISOString()).toBe('2026-10-07T16:00:00.000Z');
    });

    it('做错后回到第一轮，未作答记录不影响计划', () => {
        const plan = getReviewPlan(created, [
            { result: 'correct', createdAt: at('2026-10-02T02:00:00Z') },
            { result: 'wrong', createdAt: at('2026-10-05T02:00:00Z') },
            { result: 'not_attempted', createdAt: at('2026-10-09T02:00:00Z') },
        ], TZ);
        expect(plan.stage).toBe(0);
        expect(plan.nextReviewAt?.toISOString()).toBe('2026-10-05T16:00:00.000Z');
    });

    it('记录顺序不影响结果', () => {
        const records = [
            { result: 'correct', createdAt: at('2026-10-06T02:00:00Z') },
            { result: 'wrong', createdAt: at('2026-10-02T02:00:00Z') },
        ];
        expect(getReviewPlan(created, records, TZ).stage).toBe(1);
    });

    it('完成全部间隔后不再安排复习', () => {
        const records = REVIEW_INTERVALS.map((_, i) => ({ result: 'correct', createdAt: at(`2026-10-${String(i + 2).padStart(2, '0')}T02:00:00Z`) }));
        expect(getReviewPlan(created, records, TZ)).toEqual({ stage: REVIEW_INTERVALS.length, nextReviewAt: null });
    });
});

describe('isReviewDue', () => {
    const plan = getReviewPlan(created, [], TZ);

    it('到期日当天和之后都算到期', () => {
        expect(isReviewDue(plan, TZ, at('2026-10-01T15:59:59Z'))).toBe(false);
        expect(isReviewDue(plan, TZ, at('2026-10-01T16:00:00Z'))).toBe(true);
        expect(isReviewDue(plan, TZ, at('2026-10-20T00:00:00Z'))).toBe(true);
    });

    it('按应用时区判断今天', () => {
        // UTC 时间仍是 10-01，但纽约时区的到期日按纽约日历计算
        const nyPlan = getReviewPlan(created, [], 'America/New_York');
        expect(isReviewDue(nyPlan, 'America/New_York', at('2026-10-02T03:59:00Z'))).toBe(false);
        expect(isReviewDue(nyPlan, 'America/New_York', at('2026-10-02T04:00:00Z'))).toBe(true);
    });

    it('已完成的计划不会到期', () => {
        expect(isReviewDue({ stage: 6, nextReviewAt: null }, TZ)).toBe(false);
    });
});

describe('getStudentReviewPlan', () => {
    it('学生首次录入当天可复习，答错当天可重做，答对按 1、3、7、14 天推进', () => {
        expect(getStudentReviewPlan(created, [], TZ).nextReviewAt?.toISOString()).toBe('2026-09-30T16:00:00.000Z');
        expect(getStudentReviewPlan(created, [{ result: 'wrong', createdAt: at('2026-10-05T02:00:00Z') }], TZ).nextReviewAt?.toISOString()).toBe('2026-10-04T16:00:00.000Z');
        expect(getStudentReviewPlan(created, [{ result: 'correct', createdAt: at('2026-10-05T02:00:00Z') }], TZ).nextReviewAt?.toISOString()).toBe('2026-10-05T16:00:00.000Z');
        expect(getStudentReviewPlan(created, [
            { result: 'correct', createdAt: at('2026-10-05T02:00:00Z') },
            { result: 'correct', createdAt: at('2026-10-06T02:00:00Z') },
        ], TZ).nextReviewAt?.toISOString()).toBe('2026-10-08T16:00:00.000Z');
        expect(getStudentReviewPlan(created, [
            { result: 'correct', createdAt: at('2026-10-02T02:00:00Z') },
            { result: 'correct', createdAt: at('2026-10-03T02:00:00Z') },
            { result: 'correct', createdAt: at('2026-10-06T02:00:00Z') },
            { result: 'correct', createdAt: at('2026-10-13T02:00:00Z') },
        ], TZ).nextReviewAt?.toISOString()).toBe('2026-10-26T16:00:00.000Z');
    });
});

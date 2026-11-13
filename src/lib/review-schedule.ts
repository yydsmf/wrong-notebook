import { getDayRange, shiftCalendarDate } from "@/lib/date-time";

/** 管理员原有的复习间隔，保持管理员端行为不变。 */
export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30] as const;
/** 普通用户答题后的复习间隔。 */
export const STUDENT_REVIEW_INTERVALS = [1, 3, 7, 14] as const;

export interface ReviewRecord {
    result: string | null;
    createdAt: Date;
}

export interface ReviewPlan {
    /** 当前所在档位，等于末尾连续做对的次数 */
    stage: number;
    /** 下次复习时间；已完成全部间隔时为 null */
    nextReviewAt: Date | null;
}

/**
 * 根据作答历史推算复习计划：以最近一次作答（没有作答时以录入时间）为起点，
 * 加上当前档位的间隔。未作答（not_attempted）的记录不影响计划。
 */
export function getReviewPlan(itemCreatedAt: Date, records: ReviewRecord[], timeZone: string): ReviewPlan {
    const answered = records
        .filter((record) => record.result === "correct" || record.result === "wrong")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let consecutiveCorrect = 0;
    for (let i = answered.length - 1; i >= 0 && answered[i].result === "correct"; i--) {
        consecutiveCorrect++;
    }
    if (consecutiveCorrect >= REVIEW_INTERVALS.length) {
        return { stage: REVIEW_INTERVALS.length, nextReviewAt: null };
    }

    const last = answered.at(-1)?.createdAt ?? itemCreatedAt;
    const stage = consecutiveCorrect;
    // 按日历日安排：到期当天的零点起即可复习
    const nextReviewAt = getDayRange(shiftCalendarDate(last, timeZone, REVIEW_INTERVALS[stage]), timeZone).start;
    return { stage, nextReviewAt };
}

/** 学生首次当天可重做；答错当天重做，答对后依次按 1、3、7、14 天安排。 */
export function getStudentReviewPlan(itemCreatedAt: Date, records: ReviewRecord[], timeZone: string): ReviewPlan {
    const answered = records
        .filter((record) => record.result === "correct" || record.result === "wrong")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const latest = answered.at(-1);
    if (!latest) return { stage: 0, nextReviewAt: getDayRange(itemCreatedAt, timeZone).start };
    if (latest.result === "wrong") return { stage: 0, nextReviewAt: getDayRange(latest.createdAt, timeZone).start };

    let consecutiveCorrect = 0;
    for (let i = answered.length - 1; i >= 0 && answered[i].result === "correct"; i--) consecutiveCorrect++;
    if (consecutiveCorrect > STUDENT_REVIEW_INTERVALS.length) {
        return { stage: consecutiveCorrect, nextReviewAt: null };
    }

    const interval = STUDENT_REVIEW_INTERVALS[consecutiveCorrect - 1];
    return {
        stage: consecutiveCorrect,
        nextReviewAt: getDayRange(shiftCalendarDate(latest.createdAt, timeZone, interval), timeZone).start,
    };
}

/** 下次复习时间不晚于今天（应用时区）即为到期 */
export function isReviewDue(plan: ReviewPlan, timeZone: string, now = new Date()): boolean {
    return plan.nextReviewAt !== null && plan.nextReviewAt < getDayRange(now, timeZone).end;
}

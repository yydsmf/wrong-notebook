import { describe, expect, it } from 'vitest';
import { normalizeAnswerText } from '@/lib/ai/answer-format';

describe('多小题答案排版', () => {
    it('在相同题号答案粘连时补充空格', () => {
        expect(normalizeAnswerText(
            '39.moved40.have',
            '39. We ___ to school yesterday. 40. They ___ lunch at twelve.',
        )).toBe('39.moved 40.have');
    });

    it('保留已有分号和换行，不重复添加分隔符', () => {
        expect(normalizeAnswerText(
            '39.moved;40.have',
            '39. ... 40. ...',
        )).toBe('39.moved;40.have');
        expect(normalizeAnswerText(
            '39. moved\n40. have',
            '39. ... 40. ...',
        )).toBe('39. moved\n40. have');
    });

    it('不把小数或没有对应题号的普通答案误判为多小题', () => {
        expect(normalizeAnswerText('1.5 + 2.5 = 4', '计算 1.5 + 2.5 的结果。')).toBe('1.5 + 2.5 = 4');
        expect(normalizeAnswerText('movedhave', '39. ... 40. ...')).toBe('movedhave');
    });

    it('支持括号编号小题', () => {
        expect(normalizeAnswerText('（1）moved（2）have', '（1）...（2）...')).toBe('（1）moved （2）have');
    });
});

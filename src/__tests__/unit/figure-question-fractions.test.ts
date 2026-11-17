import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const fraction = (numerator = '3', denominator = '4') => ({
    type: 'fraction', numerator, denominator, model: 'fraction',
});
const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧分数</text></svg>';

describe('题干分数与结构化分数的一致性', () => {
    it.each([
        '分数为3/4。', '这个分数的值是3／4。', '分数式等于 +03 / 04。',
        'The fraction is 3/4.', 'The fraction shown equals +03 / 04.',
        '分子是3，分母是4。', '分母为4，分子为3。',
        'numerator = 3 and denominator = 4.', 'denominator = 4 and numerator = 3.',
    ])('明确分数声明一致时保留结构：%s', (question) => {
        expect(parseFigureSpec(raw(fraction()), question)).not.toBeNull();
        expect(parseFigureSpec(raw(fraction('x', 'y')), question)).toBeNull();
    });

    it.each([
        '分数为2/4。', '分数的值是3/5。', '分子是2，分母是4。',
        'The fraction is 4/3.', 'numerator is 3, denominator is 5.',
    ])('明确分数声明冲突时回退：%s', (question) => {
        const spec = raw(fraction());
        expect(parseFigureSpec(spec, question)).toBeNull();
        expect(parseFigure('true', legacy, spec, question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('带分数只核对剩余分数，不丢失 whole', () => {
        const spec = raw({ type: 'fraction', whole: '2', numerator: '3', denominator: '4', model: 'bar', parts: 4, filled: 3 });
        expect(parseFigureSpec(spec, '分数为3/4，整数部分为2。')).not.toBeNull();
        expect(parseFigureSpec(spec, '分数为1/4，整数部分为2。')).toBeNull();
    });

    it('候选、疑问、假设、引用、多个分数和复杂表达式保持保守', () => {
        const spec = raw(fraction());
        for (const question of [
            '下列分数中，3/4和2/4哪个正确？',
            '分数是2/4吗？', '分数为2/4，对吗？', '分数为2/4，正确吗？',
            '分数为2/4：成立吗？', '如果分数为2/4，求它的值。',
            '“分数为2/4”。', '比较分数3/4与1/2。',
            '分数为x/4。', '求分数 3/（x+1）。',
        ]) expect(parseFigureSpec(spec, question), question).not.toBeNull();
    });

    it('图组按题干标签分别核对分数，冲突时整组回退', () => {
        const group = {
            type: 'figure_group', figures: [
                { label: '甲', figure: fraction('3', '4') },
                { label: '乙', figure: fraction('1', '2') },
            ],
        };
        const question = '图甲中：分数为3/4；图乙中：分数为1/2。';
        expect(parseFigureSpec(raw(group), question)).not.toBeNull();
        expect(parseFigureSpec(raw(group), question.replace('1/2', '2/3'))).toBeNull();
    });
});

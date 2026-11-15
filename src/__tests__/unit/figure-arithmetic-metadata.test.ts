import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { extractFigureArithmeticConstraints } from '@/lib/figure-arithmetic-constraints';
import { parseFigureSpec } from '@/lib/figure-spec';

const raw = (top = '34', bottom = '25', operation = '×') => JSON.stringify({
    type: 'vertical_arithmetic', operation, top, bottom,
});

describe('竖式条件中的题首附加信息与公式样式', () => {
    it.each([
        '日期：2026-11-15。',
        '日期: 2024/02/29\n',
        'Date: 2000-02-29. ',
        'DATE: 2026/1/5; ',
        '日期：2026-11-15，',
        '练习时间：10:20-10:30。',
        '答题时间：09:00 至 09:40\n',
        'Time: 23:50-00:10. ',
        '第1-3题选做。',
        '第 1 至 3 题必做；',
        '第1～3题\n',
        '日期：2026-11-15。时间：10:20-10:30。第1-3题选做。',
    ])('明确的题首信息不能取消后续算式校验：%s', (prefix) => {
        const question = `${prefix}列竖式计算34×25。`;
        expect(parseFigureSpec(raw(), question)).toMatchObject({ top: '34', bottom: '25' });
        expect(parseFigureSpec(raw('43'), question)).toBeNull();
        expect(parseFigureSpec(raw('34', '24'), question)).toBeNull();
        expect(parseFigureSpec(raw('34', '25', '+'), question)).toBeNull();
    });

    it('全角标点和数字在已有规范化后仍能区分日期与目标算式', () => {
        const question = '日期：２０２６－１１－１５。计算３４×２５。';
        expect(parseFigureSpec(raw(), question)).not.toBeNull();
        expect(parseFigureSpec(raw('43'), question)).toBeNull();
    });

    it.each(['日期：2026-11-15。', '时间：10:20-10:30。', '第1-3题选做。'])('题首信息不取消明确整数位数：%s', (prefix) => {
        const question = `${prefix}观察两位数乘25的竖式。`;
        expect(parseFigureSpec(raw('□□'), question)).toMatchObject({ top: '□□', bottom: '25' });
        expect(parseFigureSpec(raw('3.4'), question)).toBeNull();
        expect(parseFigureSpec(raw('34', '24'), question)).toBeNull();
    });

    it.each(['日期：2026-11-15。', '时间：10:20-10:30。', '第1-3题选做。'])('只有题首信息时不据此猜测竖式数字：%s', (question) => {
        expect(extractFigureArithmeticConstraints(question)).toEqual([]);
        expect(parseFigureSpec(raw('x', 'y'), question)).toMatchObject({ top: 'x', bottom: 'y' });
    });

    it.each(['displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle'])('无参数公式样式不取消完整算式：%s', (style) => {
        const question = `计算 $\\${style} 34\\times25$。`;
        expect(parseFigureSpec(raw(), question)).not.toBeNull();
        expect(parseFigureSpec(raw('43'), question)).toBeNull();
        expect(parseFigureSpec(raw('34', '24'), question)).toBeNull();
    });

    it('样式命令后的符号和精确小数仍完整核对', () => {
        const question = '计算 $\\displaystyle -3.4\\times25$。';
        expect(parseFigureSpec(raw('-3.4'), question)).toMatchObject({ top: '-3.4' });
        expect(parseFigureSpec(raw('3.4'), question)).toBeNull();
        expect(parseFigureSpec(raw('-4'), question)).toBeNull();
    });

    it.each(['displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'quad', 'qquad', ','])('数字紧接无参数样式或间距命令时仍完整核对：%s', (command) => {
        const question = `计算 $\\${command}34\\times25$。`;
        expect(parseFigureSpec(raw(), question)).not.toBeNull();
        expect(parseFigureSpec(raw('43'), question)).toBeNull();
    });

    it.each([
        '计算2026-11-15，再观察34×25。',
        '计算2026/11/15，再观察34×25。',
        '列竖式计算34×25。日期：2026-11-15。',
        '$日期：2026-11-15$。计算34×25。',
        '\\(日期：2026-11-15\\)。计算34×25。',
        '日期：2026-02-29。计算34×25。',
        '日期：1900-02-29。计算34×25。',
        '日期：2026-13-15。计算34×25。',
        '日期：2026-11-15.3。计算34×25。',
        '日期：2026-11-15×25。计算34×25。',
        '时间：24:00-25:00。计算34×25。',
        '时间：10:60-11:00。计算34×25。',
        '第3-1题选做。计算34×25。',
        '第0-3题选做。计算34×25。',
        '第1-3题×25。计算34×25。',
    ])('不把正文、数学片段或不完整信息当作已确认的题首信息：%s', (question) => {
        expect(extractFigureArithmeticConstraints(question)).toEqual([]);
        expect(parseFigureSpec(raw('x', 'y'), question)).not.toBeNull();
    });

    it.each([
        '日期：2026-11-15。计算34×25+7。',
        '日期：2026-11-15。比较34×25与43×25。',
        '日期：2026-11-15。比较34×25与(43×25)。',
        '计算 $\\displaystyle (34+7)\\times25$。',
        '计算 $\\displaystyle \\frac{34}{25}\\times7$。',
        '计算 $\\sqrt{34}\\times25$。',
        '计算 $\\displaystyle34\\times25$ 与 $43\\times25$。',
        '计算 $a\\displaystyle34\\times25$。',
        '计算 $\\displaystyleFoo34\\times25$。',
        '计算 $\\frac34\\times25$。',
    ])('题首信息和样式不能让复杂式或多候选失去保守保护：%s', (question) => {
        expect(extractFigureArithmeticConstraints(question)).toEqual([]);
        expect(parseFigureSpec(raw('x', 'y'), question)).not.toBeNull();
    });

    it.each(['20. 34×25', '第20题。计算34×25。', '计算20.34×25。'])('普通题号与小数仍保留原边界：%s', (question) => {
        const top = question.includes('20.34') ? '20.34' : '34';
        expect(parseFigureSpec(raw(top), question)).toMatchObject({ top });
        expect(parseFigureSpec(raw('43'), question)).toBeNull();
    });

    it('冲突时完整旧SVG回退，无可用旧图时不生成新图', () => {
        const question = '日期：2026-11-15。计算 $\\displaystyle34\\times25$。';
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>已有完整竖式</text></svg>';
        expect(parseFigure('true', legacy, raw('43'), question)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw('43'), question)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

export interface FigureArithmeticConstraint {
    operation: '+' | '-' | '×' | '÷';
    top?: string;
    bottom?: string;
    topDigits?: number;
    bottomDigits?: number;
}

interface ArithmeticToken {
    text: string;
    start: number;
    end: number;
}

const DIGIT_COUNTS: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};
const UNSIGNED_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const OPERATIONS: Record<string, FigureArithmeticConstraint['operation']> = {
    '+': '+', 加: '+', plus: '+',
    '-': '-', '−': '-', 减: '-', minus: '-',
    '×': '×', '*': '×', x: '×', 乘: '×', 乘以: '×',
    times: '×', 'multiplied by': '×', '\\times': '×', '\\cdot': '×',
    '÷': '÷', 除以: '÷', 'divided by': '÷', '\\div': '÷',
};

function operationFor(text: string | undefined): FigureArithmeticConstraint['operation'] | undefined {
    const key = text?.toLowerCase();
    return key && Object.hasOwn(OPERATIONS, key) ? OPERATIONS[key] : undefined;
}

/** 比较完整的有限十进制数，不截取数字片段，也不改写保存的原文。 */
export function arithmeticOperandMatches(actual: string, expected: string): boolean {
    const canonicalize = (value: string): string | null => {
        const text = value.trim().replace(/^−/, '-').replace(/^([+-])\s+/, '$1');
        if (text.length > 40 || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
        const [integer, decimal = ''] = text.replace(/^[+-]/, '').split('.');
        const whole = (integer || '0').replace(/^0+(?=\d)/, '');
        const fraction = decimal.replace(/0+$/, '');
        const sign = text.startsWith('-') && (whole !== '0' || fraction) ? '-' : '';
        return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
    };
    const actualValue = canonicalize(actual);
    return actualValue !== null && actualValue === canonicalize(expected);
}

function wholeOperandBoundary(text: string, start: number, end: number): boolean {
    const before = text.slice(0, start);
    const after = text.slice(end);
    // 字母、指数和千分位可能属于更大的数学标记，不能从中截取整数或小数。
    return !/[\dA-Za-z_.^²³⁰¹⁴⁵⁶⁷⁸⁹]$/u.test(before)
        && !/^[\dA-Za-z_.^²³⁰¹⁴⁵⁶⁷⁸⁹]/u.test(after.replace(/^\.(?!\d)/, ''))
        && !/\d\s*,\s*$/u.test(before)
        && !/^\s*,\s*\d/u.test(after);
}

function parseBinaryRun(tokens: ArithmeticToken[]): FigureArithmeticConstraint | null {
    let index = 0;
    const operand = (): string | null => {
        const sign = tokens[index]?.text;
        if (sign === '+' || sign === '-' || sign === '−') index += 1;
        const number = tokens[index]?.text;
        if (!number || number.length > 38 || !UNSIGNED_NUMBER.test(number)) return null;
        index += 1;
        return `${sign === '+' || sign === '-' || sign === '−' ? sign.replace('−', '-') : ''}${number}`;
    };
    const top = operand();
    const operation = operationFor(tokens[index]?.text);
    if (!top || !operation) return null;
    index += 1;
    const bottom = operand();
    return bottom && index === tokens.length ? { operation, top, bottom } : null;
}

function explicitConstraints(questionText: string): { constraints: FigureArithmeticConstraint[]; ambiguous: boolean } {
    const constraints: FigureArithmeticConstraint[] = [];
    let ambiguous = false;
    let run: ArithmeticToken[] = [];
    let previousEnd = 0;
    const flush = () => {
        if (run.length === 0) return;
        const constraint = parseBinaryRun(run);
        const bounded = wholeOperandBoundary(questionText, run[0].start, run[run.length - 1].end);
        if (constraint && bounded) constraints.push(constraint);
        else if (run.filter((token) => UNSIGNED_NUMBER.test(token.text)).length >= 2
            && run.some((token) => operationFor(token.text) || token.text === '/' || token.text.startsWith('\\'))) {
            ambiguous = true;
        }
        run = [];
    };
    // 数字、运算符及阻止截取的结构符号保留为完整片段；等号和正文分隔片段。
    const lexer = /\\[A-Za-z]+|\\[()[\],;!]|\d+(?:\.\d+)?|\.\d+|\b(?:multiplied\s+by|divided\s+by|times|plus|minus)\b|乘以?|除以|加|减|[A-Za-z]+|[×*÷+−\-/()[\]{}^_%²³⁰¹⁴⁵⁶⁷⁸⁹□＿=<>≤≥]/gu;
    for (const match of questionText.matchAll(lexer)) {
        const start = match.index;
        const end = start + match[0].length;
        if (questionText.slice(previousEnd, start).trim()) flush();
        const text = match[0].replace(/\s+/g, ' ');
        if (/^(?:=|<|>|≤|≥|\\[()[\]])$/.test(text) || (/^[A-Za-z]+$/.test(text) && !operationFor(text))) {
            flush();
        } else if (!/^(?:\\[,;!]|\\quad|\\qquad)$/.test(text)) {
            run.push({ text, start, end });
        }
        previousEnd = end;
    }
    flush();
    return { constraints, ambiguous };
}

function digitLengthConstraints(questionText: string): FigureArithmeticConstraint[] {
    const count = '(?:一|二|两|三|四|五|六|one|two|three|four|five|six|[1-6])';
    const number = '[+−-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)';
    const boundary = '(?<![一二两三四五六七八九十百千万0-9A-Za-z])';
    const expressions = [
        new RegExp(`${boundary}(?<topCount>${count})位数\\s*(?:与|和)?\\s*(?:乘以?|×|x)\\s*(?:(?:一个)\\s*)?(?:(?<bottomCount>${count})位数|(?<bottom>${number}))?`, 'giu'),
        new RegExp(`${boundary}(?<topCount>${count})位数\\s*(?:与|和)\\s*(?<bottom>${number})\\s*(?:相)?乘`, 'giu'),
        new RegExp(`\\b(?<topCount>${count})[- ]digit\\s+number\\s+(?:times|multiplied by)\\s+(?:(?:a|an)\\s+)?(?:(?<bottomCount>${count})[- ]digit\\s+number|(?<bottom>${number}))?`, 'giu'),
    ];
    const constraints: FigureArithmeticConstraint[] = [];
    for (const expression of expressions) {
        for (const match of questionText.matchAll(expression)) {
            const { topCount, bottomCount, bottom } = match.groups!;
            if (bottom) {
                const start = match.index + match[0].lastIndexOf(bottom);
                if (bottom.length > 40 || !wholeOperandBoundary(questionText, start, start + bottom.length)) continue;
            }
            constraints.push({
                operation: '×',
                topDigits: DIGIT_COUNTS[topCount.toLowerCase()] ?? Number(topCount),
                ...(bottomCount ? { bottomDigits: DIGIT_COUNTS[bottomCount.toLowerCase()] ?? Number(bottomCount) } : {}),
                ...(bottom ? { bottom } : {}),
            });
        }
    }
    return constraints;
}

/** 仅返回唯一的完整二元算式及位数条件，复杂式与多个候选不猜测对应关系。 */
export function extractFigureArithmeticConstraints(questionText: string): FigureArithmeticConstraint[] {
    const explicit = explicitConstraints(questionText);
    if (explicit.ambiguous) return [];
    const distinct = (constraints: FigureArithmeticConstraint[]) => constraints.filter((constraint, index, all) => all.findIndex((candidate) =>
        candidate.operation === constraint.operation
        && candidate.topDigits === constraint.topDigits && candidate.bottomDigits === constraint.bottomDigits
        && (candidate.top === constraint.top || Boolean(candidate.top && constraint.top && arithmeticOperandMatches(candidate.top, constraint.top)))
        && (candidate.bottom === constraint.bottom || Boolean(candidate.bottom && constraint.bottom && arithmeticOperandMatches(candidate.bottom, constraint.bottom)))) === index);
    const expressions = distinct(explicit.constraints);
    const lengths = distinct(digitLengthConstraints(questionText));
    return expressions.length > 1 || lengths.length > 1 ? [] : [...expressions, ...lengths];
}

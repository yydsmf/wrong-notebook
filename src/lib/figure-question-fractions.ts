import { arithmeticOperandMatches } from './figure-arithmetic-constraints';
import type { FigureSpec } from './figure-spec';

type Fraction = Extract<FigureSpec, { type: 'fraction' }>;

const INTEGER = String.raw`[+−-]?\s*\d+`;
const FRACTION_ASSERTIONS = [
    new RegExp(String.raw`(?<![\dA-Za-z])(?:这个|该|此|所给)?(?:分数|分数式)(?:的值|表示的数)?\s*(?:是|为|等于|=|:)?\s*(?<numerator>${INTEGER})\s*[/／]\s*(?<denominator>${INTEGER})`, 'giu'),
    new RegExp(String.raw`\b(?:the\s+)?fraction(?:\s+(?:shown|given|represented))?\s*(?:is|equals|=|:)?\s*(?<numerator>${INTEGER})\s*[/／]\s*(?<denominator>${INTEGER})`, 'giu'),
    new RegExp(String.raw`(?<![\dA-Za-z])分子\s*(?:是|为|等于|=|:)?\s*(?<numerator>${INTEGER})\s*[,，;；、]\s*分母\s*(?:是|为|等于|=|:)?\s*(?<denominator>${INTEGER})`, 'giu'),
    new RegExp(String.raw`\bnumerator\s*(?:is|equals|=|:)?\s*(?<numerator>${INTEGER})\s*(?:,|;|\band\b)\s*denominator\s*(?:is|equals|=|:)?\s*(?<denominator>${INTEGER})`, 'giu'),
    new RegExp(String.raw`(?<![\dA-Za-z])分母\s*(?:是|为|等于|=|:)?\s*(?<denominator>${INTEGER})\s*[,，;；、]\s*分子\s*(?:是|为|等于|=|:)?\s*(?<numerator>${INTEGER})`, 'giu'),
    new RegExp(String.raw`\bdenominator\s*(?:is|equals|=|:)?\s*(?<denominator>${INTEGER})\s*(?:,|;|\band\b)\s*numerator\s*(?:is|equals|=|:)?\s*(?<numerator>${INTEGER})`, 'giu'),
];

const UNCERTAIN_CONTEXT = /下列|下述|以下|选项|候选|正误|对错|选择|比较|判断|正确|错误|是否|是不是|如果|若|假设|假如|证明|求证|引用|声称|多组|另一个|另一分数|或|还是|或者|\b(?:which|choose|select|compare|judge|whether|if|assum\w*|suppos\w*|prove|verify|quoted|claim\w*|another|multiple)\b/iu;
const ALTERNATIVE_AFTER = /^(?:或|还是|或者|和|与|及|以及|\b(?:or|and|another)\b)/iu;
const QUESTION_TAG_AFTER = /^[，,：:]?\s*(?:吗|么|呢|是否|是不是|对吗|对不对|正确吗|成立吗|[?？]|\b(?:right|correct|true)\s*[?？])/iu;

interface FractionAssertion {
    numerator: string;
    denominator: string;
}

function normalizeInteger(value: string): string {
    return value.replace(/\s/gu, '').replace(/^−/, '-');
}

function sameAssertion(first: FractionAssertion, second: FractionAssertion): boolean {
    return arithmeticOperandMatches(first.numerator, second.numerator)
        && arithmeticOperandMatches(first.denominator, second.denominator);
}

/** 只核对题干唯一、明确的整数分数声明；多候选和不确定语境保持保守。 */
export function validateFigureQuestionFraction(spec: Fraction, questionText: string): boolean {
    if (UNCERTAIN_CONTEXT.test(questionText) || /["“”‘’「」『』`]/u.test(questionText)) return true;

    const assertions: FractionAssertion[] = [];
    const sentences = questionText.split(/(?<=[。!?;；])|\.(?=\s|$)/u);
    for (const sentence of sentences) {
        for (const pattern of FRACTION_ASSERTIONS) {
            for (const match of sentence.matchAll(pattern)) {
                const groups = match.groups;
                if (!groups?.numerator || !groups.denominator) continue;
                const after = sentence.slice(match.index! + match[0].length).trimStart();
                if (ALTERNATIVE_AFTER.test(after) || QUESTION_TAG_AFTER.test(after)) continue;
                assertions.push({
                    numerator: normalizeInteger(groups.numerator),
                    denominator: normalizeInteger(groups.denominator),
                });
            }
        }
    }
    if (assertions.length === 0) return true;
    const first = assertions[0]!;
    if (assertions.some((assertion) => !sameAssertion(first, assertion))) return true;
    return arithmeticOperandMatches(spec.numerator, first.numerator)
        && arithmeticOperandMatches(spec.denominator, first.denominator);
}

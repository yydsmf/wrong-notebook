import { arithmeticOperandMatches } from './figure-arithmetic-constraints';
import type { FigureSpec } from './figure-spec';

type NumberLine = Extract<FigureSpec, { type: 'number_line' }>;

const POINT_TOKEN = String.raw`[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*`;
const POINT_NAME = new RegExp(`^${POINT_TOKEN}$`, 'u');
const POINT_CHARACTERS = String.raw`A-Za-z0-9₀-₉'′″`;
const NAMED_POINT = String.raw`(?<point>${POINT_TOKEN})(?![${POINT_CHARACTERS}])`;
const NUMBER = String.raw`(?<open>\$\$?|\\\(|\\\[)?\s*(?<value>[+−-]?\s*(?:\d+(?:\.\d+)?|\.\d+))`;
const ASSERTIONS = [
    new RegExp(String.raw`(?<![${POINT_CHARACTERS}\\])(?:数轴上(?:的)?\s*)?(?:点\s*)?${NAMED_POINT}(?:点)?\s*(?:在数轴上)?\s*(?:所)?(?:表示|对应)(?:的)?(?:数值?)?\s*(?:是|为|等于|=|:)?\s*${NUMBER}`, 'giu'),
    new RegExp(String.raw`(?<![${POINT_CHARACTERS}\\])\b(?:the\s+)?point\s+${NAMED_POINT}\s+(?:represents|corresponds\s+to)\s+(?:(?:the\s+)?number\s+)?${NUMBER}(?:\s+on\s+the\s+number\s+line)?`, 'giu'),
    new RegExp(String.raw`(?<![${POINT_CHARACTERS}\\])\b(?:the\s+)?number\s+represented\s+by\s+(?:the\s+)?point\s+${NAMED_POINT}\s+(?:is|equals)\s*${NUMBER}`, 'giu'),
];
const MATH_CLOSE: Record<string, string> = { '$': '$', '$$': '$$', '\\(': '\\)', '\\[': '\\]' };
const CANDIDATE_CONTEXT = /下列|下述|以下说法|选项|候选|正误|对错|选择|正确|错误|对的|错的|哪一个|哪一点|还是|或者|\b(?:which|choose|select|statements?|correct|incorrect|true\s+or\s+false)\b/iu;
const UNCERTAIN_CONTEXT = /是否|是不是|判断|能否|证明|求证|验证|猜测|认为|声称|如果|假设|假如|若|并非|不是|不为|不一定|未必|不知道|或|[?？]|平移|移动|变化|变换|原来|原先|初始|相对|另一数轴|另一个数轴|坐标系|\b(?:whether|if|when|unless|prove|show|verify|assum\w*|suppos\w*|determine|decide|judge|claims?|says?|not|could|might|may|before|after|translation|translated|shifted|moved|another\s+number\s+line)\b|\bis\s+it\s+(?:true|correct)\b/iu;

/** Expand JavaScript's exponent notation without rounding the represented value. */
function decimalText(value: number): string {
    const [mantissa, exponent] = String(value).split('e');
    if (!exponent) return mantissa;
    const [whole, fraction = ''] = mantissa.replace(/^-/, '').split('.');
    const digits = whole + fraction;
    const position = whole.length + Number(exponent);
    const expanded = position <= 0 ? `0.${'0'.repeat(-position)}${digits}`
        : position >= digits.length ? digits + '0'.repeat(position - digits.length)
            : `${digits.slice(0, position)}.${digits.slice(position)}`;
    return mantissa.startsWith('-') ? `-${expanded}` : expanded;
}

/** Check only explicit, static point-to-number statements; ambiguous wording stays unbound. */
export function validateFigureQuestionNumberLine(spec: NumberLine, questionText: string, strictMissingPoints = false): boolean {
    if (CANDIDATE_CONTEXT.test(questionText) || UNCERTAIN_CONTEXT.test(questionText)
        || /["“”‘’「」『』`]/u.test(questionText)) return true;

    const points = new Map(spec.points.flatMap((point) => point.label && POINT_NAME.test(point.label)
        ? [[point.label, point] as const] : []));
    if (points.size === 0 && !strictMissingPoints) return true;

    const sentences = questionText.split(/(?<=[。!?;；])|\.(?=\s|$)/u);
    for (const sentence of sentences) {
        for (const pattern of ASSERTIONS) {
            for (const match of sentence.matchAll(pattern)) {
                const { point: name, open, value } = match.groups!;
                const afterMatch = sentence.slice(match.index! + match[0].length).trimStart();
                let after = afterMatch;
                if (open) {
                    const close = MATH_CLOSE[open]!;
                    if (!after.startsWith(close)) continue;
                    after = after.slice(close.length).trimStart();
                }
                if (!/^(?:$|[,，。;；!！?？\n]|\.(?!\d)|且|并且|\band\b)/iu.test(after)) continue;

                const point = points.get(name);
                if (!point) {
                    if (strictMissingPoints) return false;
                    continue;
                }
                if (!arithmeticOperandMatches(decimalText(point.value), value.replace(/\s/gu, ''))) return false;
            }
        }
    }
    return true;
}

import { arithmeticOperandMatches } from './figure-arithmetic-constraints';
import type { FigureSpec } from './figure-spec';

type CoordinatePlane = Extract<FigureSpec, { type: 'coordinate_plane' }>;

const POINT_TOKEN = String.raw`[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*`;
const POINT_NAME = new RegExp(`^${POINT_TOKEN}$`, 'u');
const POINT_CHARACTERS = String.raw`A-Za-z0-9₀-₉'′″`;
const NAMED_POINT = String.raw`(?<point>${POINT_TOKEN})(?![${POINT_CHARACTERS}])`;
const NUMBER = String.raw`[+−-]?\s*(?:\d+(?:\.\d+)?|\.\d+)`;
const TUPLE = String.raw`(?<open>\$\$?|\\\(|\\\[)?\s*\(\s*(?<x>${NUMBER})\s*[,，]\s*(?<y>${NUMBER})\s*\)`;
const ASSERTION_PREFIXES = [
    String.raw`(?:点\s*)?${NAMED_POINT}\s*(?:的)?坐标\s*(?:是|为|等于|=|:)\s*`,
    String.raw`\b(?:point\s+)?${NAMED_POINT}\s+has\s+(?:the\s+)?coordinates?(?:\s+of)?\s*:?\s*`,
    String.raw`\b(?:the\s+)?coordinates?\s+of\s+(?:point\s+)?${NAMED_POINT}\s+(?:are|is)\s*:?\s*`,
];
const ASSERTIONS = ASSERTION_PREFIXES.map((prefix) => new RegExp(String.raw`(?<![${POINT_CHARACTERS}\\])${prefix}${TUPLE}`, 'giu'));
const MATH_CLOSE: Record<string, string> = { '$': '$', '$$': '$$', '\\(': '\\)', '\\[': '\\]' };
const CANDIDATE_CONTEXT = /下列|下述|以下说法|选项|候选|正误|对错|选择|正确|错误|对的|错的|\b(?:which|choose|select|statements?|true\s+or\s+false)\b/iu;
const UNSCOPED_COORDINATE_CONTEXT = /平移|旋转|对称|变换|变化|原来|原先|初始|相对|另一个坐标系|另一坐标系|不同坐标系|[新旧]坐标系|向量|极坐标|柱坐标|球坐标|\b(?:translat\w*|rotat\w*|reflect\w*|transform\w*|original\w*|initial\w*|before|after|another|relative\w*|vectors?|polar|cylindrical|spherical|(?:new|old|different)\s+coordinate)\b/iu;
const UNCERTAIN_CONTEXT = /是否|是不是|判断|能否|证明|求证|验证|猜测|认为|声称|如果|假设|假如|若|并非|不是|不为|不一定|未必|不知道|[?？]|\b(?:whether|if|when|unless|prove|show|verify|assum\w*|suppos\w*|determine|decide|judge|claims?|says?|not|could|might|may)\b|\bis\s+it\s+(?:true|correct)\b/iu;
const REVIEW_OR_CONDITION = /^\s*(?:(?:(?:这一|这个|这|该|此)(?:句话|说法|判断|结论|陈述)\s*)?(?:对吗|对不对|正确吗|成立吗|是否|是不是)|(?:请|试)?(?:判断|证明|求证|验证)(?:这个|这一|这|该|此|正误|对错)|如果|若|假设|假如|倘若|只要|只有|除非|(?:right|correct|true)\s*[?!.;。]*\s*$|true\s+or\s+false\b|is\s+(?:it|this|that)\s+(?:true|correct)\b|(?:please\s+)?(?:determine|decide|judge|prove|show|verify)\b|\b(?:if|when|unless|provided|assum\w*|suppos\w*)\b)/iu;

/** 将 JSON 数值的指数写法展开用于十进制比较，不舍入或改写题干。 */
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

/** 仅核对静态坐标图中可唯一对应的可见点；不把相对绘图坐标或变换前后点位当作数学坐标。 */
export function validateFigureQuestionCoordinates(spec: CoordinatePlane, questionText: string, strictMissingPoints = false): boolean {
    if (CANDIDATE_CONTEXT.test(questionText) || UNSCOPED_COORDINATE_CONTEXT.test(questionText)) return true;
    const points = new Map(spec.points.flatMap((point) => point.label && POINT_NAME.test(point.label)
        ? [[point.label, point] as const] : []));
    if (points.size === 0 && !strictMissingPoints) return true;
    const sentences = questionText.split(/(?<=[。!?;])|\.(?=\s|$)/u);
    for (const [index, sentence] of sentences.entries()) {
        for (const pattern of ASSERTIONS) {
            for (const match of sentence.matchAll(pattern)) {
                const { point: name, open, x, y } = match.groups!;
                const before = sentence.slice(0, match.index);
                let after = sentence.slice(match.index + match[0].length).trimStart();
                if (open) {
                    const close = MATH_CLOSE[open]!;
                    if (!after.startsWith(close)) continue;
                    after = after.slice(close.length).trimStart();
                }
                const [tail, ...clauses] = after.split(/[,，]/u);
                if (UNCERTAIN_CONTEXT.test(before) || UNCERTAIN_CONTEXT.test(tail)
                    || /["“”‘’「」『』`]/u.test(sentence)
                    || before.trimEnd().endsWith("'") || after.startsWith("'")
                    || !/^(?:$|[,，。;!\n]|\.(?!\d)|且|并且|\band\b)/iu.test(after)
                    || clauses.some((clause) => REVIEW_OR_CONDITION.test(clause))
                    || REVIEW_OR_CONDITION.test(sentences[index + 1] ?? '')) continue;
                const expectedX = x.replace(/\s/gu, '');
                const expectedY = y.replace(/\s/gu, '');
                if (expectedX.length > 40 || expectedY.length > 40) continue;
                const point = points.get(name);
                if (!point) {
                    if (strictMissingPoints) return false;
                    continue;
                }
                if (!arithmeticOperandMatches(decimalText(point.x), expectedX)
                    || !arithmeticOperandMatches(decimalText(point.y), expectedY)) return false;
            }
        }
    }
    return true;
}

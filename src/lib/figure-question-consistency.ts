import type { FigureSpec } from './figure-spec';
import { validateFigureLengths } from './figure-measurements';
import { arithmeticOperandMatches, extractFigureArithmeticConstraints } from './figure-arithmetic-constraints';
import type { FigureArithmeticConstraint } from './figure-arithmetic-constraints';

type ExplicitQuestionShape = 'triangle' | 'rectangle' | 'square' | 'parallelogram' | 'trapezoid' | 'cube' | 'cuboid';

const QUESTION_SHAPE_PATTERNS: Array<{ shape: ExplicitQuestionShape; pattern: RegExp }> = [
    { shape: 'triangle', pattern: /三角形|\btriangles?\b/iu },
    { shape: 'rectangle', pattern: /长方形|矩形|\brectangles?\b/iu },
    { shape: 'square', pattern: /正方形|\bsquares?\b/iu },
    { shape: 'parallelogram', pattern: /平行四边形|\bparallelograms?\b/iu },
    { shape: 'trapezoid', pattern: /梯形|\btrapezoids?\b/iu },
    { shape: 'cube', pattern: /正方体|立方体|\bcubes?\b/iu },
    { shape: 'cuboid', pattern: /长方体|\bcuboids?\b|\brectangular prisms?\b/iu },
];

const FIGURE_ASSERTION_PREFIX = String.raw`(?:(?:下图|该图|此图|图形)(?:所示)?(?:是|为)(?:一个|一块|一张)?(?:等腰|等边|直角)?|\b(?:the|this)\s+(?:figure|shape|diagram|solid)\s+is\s+(?:a|an)\s+(?:(?:right|isosceles|equilateral)\s+)?)`;
const AMBIGUOUS_SHAPE_CONTEXT = /不是|并非|不一定|不为|还是|\b(?:not|isn't|isn’t|might|could)\b/iu;
const UNCERTAIN_ASSERTION_CONTEXT = /是否|判断|能否|证明|试问|请问|猜测|认为|声称|说|如果|若|假设|假如|倘若|只要|只有|除非|当|[?？]|吗|么|呢|\b(?:which|whether|if|when|unless|assum(?:e|ing)|suppos(?:e|ing)|provided|prove|show|determine|decide|judge|says?|said|claims?|thinks?)\b|\bis\s+it\s+(?:true|correct)\b|\btrue\s+or\s+false\b/iu;
const ASSERTION_QUESTION_TAG = /^\s*(?:(?:(?:这一|这个|这|该|此)(?:句话|说法|判断|结论|陈述)\s*)?(?:对吗|对不对|正确吗|成立吗|(?:是否|是不是)(?:正确|成立|属实|为真|这样|如此|真的))|(?:是否|是不是)\s*[?。;]?\s*$|(?:right|correct|true)\s*[?!;.]?\s*$|true\s+or\s+false\b|is\s+(?:it|this|that)(?:\s+(?:statement|claim|assertion))?\s+(?:true|correct|right)\b|is\s+(?:it|this|that)\s*[?!;.]?\s*$)/iu;
const ASSERTION_REVIEW_COMMAND = /^\s*(?:(?:请|试)?(?:判断|辨别|检验|证明)(?:(?:这一|这个|这|该|此)(?:句话|说法|判断|结论|陈述)|正误|对错)|(?:please\s+)?(?:determine|decide|state|judge|prove|show)\s+(?:(?:whether|if)\s+)?(?:this|that|the)\s+(?:statement|claim|assertion)\b)/iu;
const ASSERTION_POSTCONDITION = /^\s*(?:如果|若|假设|假如|倘若|只要|只有|除非|\b(?:if|when|unless|provided|assum(?:e|ing)|suppos(?:e|ing))\b)/iu;
const PARTIAL_FIGURE_QUESTION = /阴影|涂色|部分|拼|切|裁|折|展开|截面|剖面|投影|表面|侧面|底面|内部|外部|选项|\b(?:inside|outside|shaded|parts?|sections?|projections?|nets?|faces?|cuts?|folds?|options?)\b/iu;

function normalizeQuestionText(value: string): string {
    return value.replace(/[\uff01-\uff5e]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}

function digitCountMatches(actual: string, expected: number): boolean {
    if (!/^[\d□?_＿]+$/u.test(actual)) return true;
    return actual.length === expected;
}

function uniqueQuestionShape(questionText: string): ExplicitQuestionShape | null {
    if (AMBIGUOUS_SHAPE_CONTEXT.test(questionText) || PARTIAL_FIGURE_QUESTION.test(questionText)) return null;
    const shapes = QUESTION_SHAPE_PATTERNS.filter(({ pattern }) => pattern.test(questionText));
    if (shapes.length !== 1) return null;
    const candidate = shapes[0];
    const assertion = new RegExp(`${FIGURE_ASSERTION_PREFIX}(?:${candidate.pattern.source})`, 'giu');
    // 小数点不截句，换行也可能只是转录折行；句尾提问不取消前一独立声明。
    const sentences = questionText.split(/(?<=[。!?;])|\.(?=\s|$)/u);
    for (const [index, sentence] of sentences.entries()) {
        for (const match of sentence.matchAll(assertion)) {
            const before = sentence.slice(0, match.index);
            const [tail, ...followingClauses] = sentence.slice(match.index + match[0].length).split(/[,，]/u);
            const context = `${before} ${tail}`;
            if (UNCERTAIN_ASSERTION_CONTEXT.test(context) || /^\s*(?:时|的话|的情况下|的条件下)/u.test(tail)) continue;
            // 引用、形状附加问句和后置条件仍不作为事实，不移动或补写题目内容。
            if (/["“”‘’「」『』`]/u.test(context) || before.trimEnd().endsWith("'") || tail.trimStart().startsWith("'")) continue;
            if (followingClauses.some((clause) => ASSERTION_QUESTION_TAG.test(clause)
                || ASSERTION_REVIEW_COMMAND.test(clause) || ASSERTION_POSTCONDITION.test(clause))) continue;
            const nextSentence = sentences[index + 1] ?? '';
            if (ASSERTION_QUESTION_TAG.test(nextSentence) || ASSERTION_REVIEW_COMMAND.test(nextSentence)) continue;
            return candidate.shape;
        }
    }
    return null;
}

function matchesAreaShape(spec: Extract<FigureSpec, { type: 'area_geometry' }>, expected: ExplicitQuestionShape): boolean {
    const rectangle = spec.shape === 'rectangle' || spec.shape === 'square'
        || (spec.shape === 'parallelogram' && (spec.offset ?? 0) === 0);
    switch (expected) {
        case 'square':
            return rectangle
                && Math.abs(spec.width - spec.height) <= Math.max(0.01, spec.width * 0.02)
                && validateFigureLengths([{ label: spec.baseLabel }, { label: spec.heightLabel }, { label: spec.topLabel }], true);
        case 'rectangle': return rectangle;
        case 'parallelogram': return rectangle || spec.shape === 'parallelogram';
        case 'triangle': return spec.shape === 'triangle';
        case 'trapezoid': return spec.shape === 'trapezoid';
        // 立体题可能只绘制一个面，不把立体形状强加给面积模板。
        default: return true;
    }
}

function matchesSolidShape(spec: Extract<FigureSpec, { type: 'solid_geometry' }>, expected: ExplicitQuestionShape): boolean {
    if (expected !== 'cube') return true;
    const maximum = Math.max(spec.width, spec.depth, spec.height);
    const tolerance = Math.max(0.01, maximum * 0.02);
    return Math.abs(spec.width - spec.depth) <= tolerance && Math.abs(spec.width - spec.height) <= tolerance
        && validateFigureLengths([{ label: spec.widthLabel }, { label: spec.depthLabel }, { label: spec.heightLabel }], true);
}

function matchesArithmeticConstraint(
    figure: Extract<FigureSpec, { type: 'vertical_arithmetic' }>,
    constraint: FigureArithmeticConstraint,
): boolean {
    if (figure.operation !== constraint.operation) return false;
    if (constraint.top && !arithmeticOperandMatches(figure.top, constraint.top)) return false;
    if (constraint.bottom && !arithmeticOperandMatches(figure.bottom, constraint.bottom)) return false;
    if (constraint.topDigits && !digitCountMatches(figure.top, constraint.topDigits)) return false;
    if (constraint.bottomDigits && !digitCountMatches(figure.bottom, constraint.bottomDigits)) return false;
    return true;
}

/** 只核对明确算式、位数及主图声明，不推断故事关系或局部图形。 */
export function validateFigureQuestionConsistency(spec: FigureSpec, questionText?: string | null): boolean {
    if (!questionText?.trim() || spec.type === 'figure_group') return true;
    const normalizedQuestion = normalizeQuestionText(questionText);
    const questionShape = uniqueQuestionShape(normalizedQuestion);
    if (questionShape && spec.type === 'area_geometry') {
        return matchesAreaShape(spec, questionShape);
    }
    if (questionShape && spec.type === 'solid_geometry') {
        return matchesSolidShape(spec, questionShape);
    }
    if (spec.type !== 'vertical_arithmetic') return true;
    return extractFigureArithmeticConstraints(normalizedQuestion).every((constraint) => matchesArithmeticConstraint(spec, constraint));
}

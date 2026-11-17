import type { FigureSpec } from './figure-spec';
import { validateFigureLengths } from './figure-measurements';
import { validateFigurePolygonShape } from './figure-polygon-consistency';
import type { PolygonQuestionShape } from './figure-polygon-consistency';
import { validateFigureTriangle } from './figure-triangle-consistency';
import type { TriangleQuestionConstraint } from './figure-triangle-consistency';
import { validateFigureBasicCircleNamedRelations, validateFigureCircleNamedRelations, validateFigureNamedAngleLabels, validateFigureNamedLengthLabels, validateFigureNamedRelations } from './figure-named-relations';
import { arithmeticDigitCountMatches, arithmeticOperandMatches, extractFigureArithmeticConstraints } from './figure-arithmetic-constraints';
import type { FigureArithmeticConstraint } from './figure-arithmetic-constraints';
import { validateFigureTemplateDimensions } from './figure-question-dimensions';
import { validateFigureQuestionCoordinates } from './figure-question-coordinates';
import { validateFigureQuestionNumberLine } from './figure-question-number-line';
import { validateFigureQuestionFraction } from './figure-question-fractions';

type ExplicitQuestionShape = PolygonQuestionShape | 'cube' | 'cuboid' | 'cylinder' | 'cone' | 'sphere';
interface QuestionShapeAssertion {
    shape: ExplicitQuestionShape;
    triangle?: TriangleQuestionConstraint;
    namedPoints?: string[];
    dimensionText: string;
}

const QUESTION_SHAPE_PATTERNS: Array<{ shape: ExplicitQuestionShape; pattern: RegExp }> = [
    { shape: 'triangle', pattern: /三角形|\btriangles?\b/iu },
    { shape: 'rectangle', pattern: /长方形|矩形|\brectangles?\b/iu },
    { shape: 'square', pattern: /正方形|\bsquares?\b/iu },
    { shape: 'rhombus', pattern: /菱形|\brhomb(?:us(?:es)?|i)\b/iu },
    { shape: 'parallelogram', pattern: /平行四边形|\bparallelograms?\b/iu },
    { shape: 'trapezoid', pattern: /梯形|\btrapezoids?\b/iu },
    { shape: 'cube', pattern: /正方体|立方体|\bcubes?\b/iu },
    { shape: 'cuboid', pattern: /长方体|\bcuboids?\b|\brectangular prisms?\b/iu },
    { shape: 'cylinder', pattern: /圆柱|\bcylinders?\b/iu },
    { shape: 'cone', pattern: /圆锥|\bcones?\b/iu },
    { shape: 'sphere', pattern: /(?<!半)球(?:体)?(?!面|冠|缺|壳)|\bspheres?\b/iu },
];

const FIGURE_ASSERTION_PREFIX = String.raw`(?:(?:下图|该图|此图|图形|这(?:个|幅|张)?(?:图形|图)?)(?:所示)?(?:是|为)(?:一个|一块|一张)?(?<chineseModifiers>(?:等腰|等边|直角){0,3})|\b(?:(?:the\s+(?:figure|shape|diagram|solid))|(?:this(?:\s+(?:figure|shape|diagram|solid))?))\s+is\s+(?:a|an)\s+(?<englishModifiers>(?:(?:right(?:[-\s]+angled)?|isosceles|equilateral)[-\s]+){0,3}))`;
const DIRECT_NAMED_SHAPE_PATTERNS: Array<{
    shape: ExplicitQuestionShape;
    pointCount: 3 | 4;
    pattern: RegExp;
    triangle?: boolean;
}> = [
    {
        shape: 'triangle', pointCount: 3, triangle: true,
        pattern: /(?:△|三角形)\s*([A-Za-z](?:\s*[A-Za-z]){2})\s*(?:是|为)\s*(?:一个)?((?:等腰|等边|直角){0,3})三角形/giu,
    },
    {
        shape: 'triangle', pointCount: 3, triangle: true,
        pattern: /\btriangles?\s*([A-Za-z](?:\s*[A-Za-z]){2})\s+(?:is|are)\s+(?:(?:a|an)\s+)?((?:(?:right(?:[-\s]+angled)?|isosceles|equilateral)[-\s]+){0,3})triangles?\b/giu,
    },
    { shape: 'square', pointCount: 4, pattern: /(?<![A-Za-z0-9₀-₉'′″])(?:四边形\s*)?([A-Za-z](?:\s*[A-Za-z]){3})\s*(?:是|为)\s*(?:一个)?正方形/giu },
    { shape: 'rhombus', pointCount: 4, pattern: /(?<![A-Za-z0-9₀-₉'′″])(?:四边形\s*)?([A-Za-z](?:\s*[A-Za-z]){3})\s*(?:是|为)\s*(?:一个)?菱形/giu },
    { shape: 'rectangle', pointCount: 4, pattern: /(?<![A-Za-z0-9₀-₉'′″])(?:四边形\s*)?([A-Za-z](?:\s*[A-Za-z]){3})\s*(?:是|为)\s*(?:一个)?(?:长方形|矩形)/giu },
    { shape: 'parallelogram', pointCount: 4, pattern: /(?<![A-Za-z0-9₀-₉'′″])(?:四边形\s*)?([A-Za-z](?:\s*[A-Za-z]){3})\s*(?:是|为)\s*(?:一个)?平行四边形/giu },
    { shape: 'trapezoid', pointCount: 4, pattern: /(?<![A-Za-z0-9₀-₉'′″])(?:四边形\s*)?([A-Za-z](?:\s*[A-Za-z]){3})\s*(?:是|为)\s*(?:一个)?梯形/giu },
    { shape: 'square', pointCount: 4, pattern: /\b(?:quadrilaterals?\s+)?([A-Za-z](?:\s*[A-Za-z]){3})\s+(?:is|are)\s+(?:a|an)?\s*square\b/giu },
    { shape: 'rhombus', pointCount: 4, pattern: /\b(?:quadrilaterals?\s+)?([A-Za-z](?:\s*[A-Za-z]){3})\s+(?:is|are)\s+(?:a|an)?\s*rhomb(?:us(?:es)?|i)\b/giu },
    { shape: 'rectangle', pointCount: 4, pattern: /\b(?:quadrilaterals?\s+)?([A-Za-z](?:\s*[A-Za-z]){3})\s+(?:is|are)\s+(?:a|an)?\s*rectangles?\b/giu },
    { shape: 'parallelogram', pointCount: 4, pattern: /\b(?:quadrilaterals?\s+)?([A-Za-z](?:\s*[A-Za-z]){3})\s+(?:is|are)\s+(?:a|an)?\s*parallelograms?\b/giu },
    { shape: 'trapezoid', pointCount: 4, pattern: /\b(?:quadrilaterals?\s+)?([A-Za-z](?:\s*[A-Za-z]){3})\s+(?:is|are)\s+(?:a|an)?\s*trapezoids?\b/giu },
];
const AMBIGUOUS_SHAPE_CONTEXT = /不是|并非|不一定|不为|还是|\b(?:not|isn't|isn’t|might|could)\b/iu;
const UNCERTAIN_ASSERTION_CONTEXT = /是否|判断|能否|证明|试问|请问|猜测|认为|声称|说|如果|若|假设|假如|倘若|只要|只有|除非|当|[?？]|吗|么|呢|\b(?:which|whether|if|when|unless|assum(?:e|ing)|suppos(?:e|ing)|provided|prove|show|determine|decide|judge|says?|said|claims?|thinks?)\b|\bis\s+it\s+(?:true|correct)\b|\btrue\s+or\s+false\b/iu;
const ASSERTION_QUESTION_TAG = /^\s*(?:(?:(?:这一|这个|这|该|此)(?:句话|说法|判断|结论|陈述)\s*)?(?:对吗|对不对|正确吗|成立吗|(?:是否|是不是)(?:正确|成立|属实|为真|这样|如此|真的))|(?:是否|是不是)\s*[?。;]?\s*$|(?:right|correct|true)\s*[?!;.]?\s*$|true\s+or\s+false\b|is\s+(?:it|this|that)(?:\s+(?:statement|claim|assertion))?\s+(?:true|correct|right)\b|is\s+(?:it|this|that)\s*[?!;.]?\s*$)/iu;
const ASSERTION_REVIEW_COMMAND = /^\s*(?:(?:请|试)?(?:判断|辨别|检验|证明)(?:(?:这一|这个|这|该|此)(?:句话|说法|判断|结论|陈述)|正误|对错)|(?:please\s+)?(?:determine|decide|state|judge|prove|show)\s+(?:(?:whether|if)\s+)?(?:this|that|the)\s+(?:statement|claim|assertion)\b)/iu;
const ASSERTION_POSTCONDITION = /^\s*(?:如果|若|假设|假如|倘若|只要|只有|除非|\b(?:if|when|unless|provided|assum(?:e|ing)|suppos(?:e|ing))\b)/iu;
const PARTIAL_FIGURE_QUESTION = /阴影|涂色|部分|拼|切|裁|折|展开|截面|剖面|投影|表面|侧面|底面|内部|外部|选项|\b(?:inside|outside|shaded|parts?|sections?|projections?|nets?|faces?|cuts?|folds?|options?)\b/iu;
const GROUP_CANDIDATE_CONTEXT = /选择|下列|下述|以下|候选|正误|对错|正确|错误|对的|错的|\b(?:which|choose|select|statements?|true|false|correct|incorrect)\b/iu;
const NET_CANDIDATE_CONTEXT = /哪些|哪种|哪一个|能(?:折|拼|组成)|不能|不可|无法|是否能|\b(?:which\s+nets?|can\s+(?:fold|form|make)|cannot|can't|unable)\b/iu;
const CUBE_NET_ASSERTION = /(?:正方体|立方体)\s*(?:的)?\s*展开图|展开图[^。！？?？;；]{0,12}(?:正方体|立方体)|\b(?:cube)\s+net\b|\bnet\s+of\s+(?:a\s+)?cube\b/iu;
const CUBOID_NET_ASSERTION = /长方体\s*(?:的)?\s*展开图|展开图[^。！？?？;；]{0,12}长方体|\b(?:cuboid|rectangular\s+prism)\s+net\b|\bnet\s+of\s+(?:a\s+)?(?:cuboid|rectangular\s+prism)\b/iu;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeQuestionText(value: string): string {
    return value.replace(/[\uff01-\uff5e]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}

function parseNamedPoints(value: string, count: 3 | 4): string[] | null {
    const compact = value.replace(/\s+/gu, '');
    const reserved = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'area', 'shape', 'figure']);
    return compact.length === count && /^[A-Za-z]+$/u.test(compact)
        && !reserved.has(compact.toLowerCase()) && new Set(compact).size === count ? [...compact] : null;
}

function directNamedQuestionShape(questionText: string): QuestionShapeAssertion | null {
    if (GROUP_CANDIDATE_CONTEXT.test(questionText)) return null;
    const sentences = questionText.split(/(?<=[。!?;])|\.(?=\s|$)/u);
    const matches: Array<{
        candidate: (typeof DIRECT_NAMED_SHAPE_PATTERNS)[number];
        match: RegExpMatchArray;
        sentence: string;
        sentenceStart: number;
        sentenceIndex: number;
    }> = [];
    let sentenceOffset = 0;
    for (const [sentenceIndex, sentence] of sentences.entries()) {
        const sentenceStart = questionText.indexOf(sentence, sentenceOffset);
        sentenceOffset = sentenceStart + sentence.length;
        for (const candidate of DIRECT_NAMED_SHAPE_PATTERNS) {
            for (const match of sentence.matchAll(candidate.pattern)) matches.push({ candidate, match, sentence, sentenceStart, sentenceIndex });
        }
    }
    if (matches.length !== 1) return null;
    const { candidate, match, sentence, sentenceStart, sentenceIndex } = matches[0]!;
    const before = sentence.slice(0, match.index);
    const after = sentence.slice(match.index! + match[0].length);
    const [tail, ...followingClauses] = after.split(/[,，]/u);
    const context = `${before} ${tail}`;
    const nextSentence = sentences[sentenceIndex + 1] ?? '';
    if (UNCERTAIN_ASSERTION_CONTEXT.test(context)
        || AMBIGUOUS_SHAPE_CONTEXT.test(context)
        || /^\s*(?:时|的话|的情况下|的条件下)/u.test(tail)
        || /["“”‘’「」『』`]/u.test(context)
        || before.trimEnd().endsWith("'") || tail.trimStart().startsWith("'")
        || /(?<![A-Za-z0-9₀-₉'′″])[A-Za-z]\s+$/u.test(before)
        || followingClauses.some((clause) => ASSERTION_QUESTION_TAG.test(clause)
            || ASSERTION_REVIEW_COMMAND.test(clause) || ASSERTION_POSTCONDITION.test(clause))
        || ASSERTION_QUESTION_TAG.test(nextSentence) || ASSERTION_REVIEW_COMMAND.test(nextSentence)) return null;
    const namedPoints = parseNamedPoints(match[1] ?? '', candidate.pointCount);
    if (!namedPoints) return null;
    const modifiers = match[2] ?? '';
    const triangle = candidate.triangle ? {
        isosceles: /等腰|isosceles/iu.test(modifiers),
        equilateral: /等边|equilateral/iu.test(modifiers),
        right: /直角|right/iu.test(modifiers),
    } : undefined;
    return {
        shape: candidate.shape,
        ...(triangle ? { triangle } : {}),
        namedPoints,
        dimensionText: questionText.slice(sentenceStart + match.index! + match[0].length),
    };
}

function uniqueQuestionShape(questionText: string): QuestionShapeAssertion | null {
    // “底面半径/直径”是整图尺寸；单独讨论底面、截面或展开图仍属于局部图。
    const shapeContext = questionText.replace(/底面(?=半径|直径)/gu, '').replace(/\bbase\s+(?=radius|diameter)/giu, '');
    if (AMBIGUOUS_SHAPE_CONTEXT.test(questionText) || PARTIAL_FIGURE_QUESTION.test(shapeContext)) return null;
    const shapes = QUESTION_SHAPE_PATTERNS.filter(({ pattern }) => pattern.test(questionText));
    if (shapes.length !== 1) return null;
    const named = directNamedQuestionShape(questionText);
    if (named) return named;
    const candidate = shapes[0];
    const assertion = new RegExp(`${FIGURE_ASSERTION_PREFIX}(?:${candidate.pattern.source})`, 'giu');
    // 小数点不截句，换行也可能只是转录折行；句尾提问不取消前一独立声明。
    const sentences = questionText.split(/(?<=[。!?;])|\.(?=\s|$)/u);
    let sentenceOffset = 0;
    for (const [index, sentence] of sentences.entries()) {
        const sentenceStart = questionText.indexOf(sentence, sentenceOffset);
        sentenceOffset = sentenceStart + sentence.length;
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
            const modifiers = match.groups?.chineseModifiers || match.groups?.englishModifiers || '';
            const triangle = candidate.shape === 'triangle' && modifiers ? {
                isosceles: /等腰|isosceles/iu.test(modifiers),
                equilateral: /等边|equilateral/iu.test(modifiers),
                right: /直角|right/iu.test(modifiers),
            } : undefined;
            return {
                shape: candidate.shape,
                ...(triangle ? { triangle } : {}),
                dimensionText: questionText.slice(sentenceStart + match.index + match[0].length),
            };
        }
    }
    return null;
}

/**
 * 展开图属于局部图，不能复用普通主图形状提取；但明确写出的正方体／长方体展开图仍需防止模板错配。
 * 选择、判断、能否折成等语境保持保守，不把待判断命题当成事实。
 */
function explicitNetShape(questionText: string): 'cube' | 'cuboid' | null {
    if (GROUP_CANDIDATE_CONTEXT.test(questionText)
        || NET_CANDIDATE_CONTEXT.test(questionText)
        || UNCERTAIN_ASSERTION_CONTEXT.test(questionText)
        || AMBIGUOUS_SHAPE_CONTEXT.test(questionText)
        || /["“”‘’「」『』`]/u.test(questionText)) return null;
    const cube = CUBE_NET_ASSERTION.test(questionText);
    const cuboid = CUBOID_NET_ASSERTION.test(questionText);
    if (cube === cuboid) return null;
    return cube ? 'cube' : cuboid ? 'cuboid' : null;
}

function matchesAreaShape(spec: Extract<FigureSpec, { type: 'area_geometry' }>, expected: QuestionShapeAssertion): boolean {
    const rectangle = spec.shape === 'rectangle' || spec.shape === 'square'
        || (spec.shape === 'parallelogram' && (spec.offset ?? 0) === 0);
    switch (expected.shape) {
        case 'square':
            return rectangle
                && Math.abs(spec.width - spec.height) <= Math.max(0.01, spec.width * 0.02)
                && validateFigureLengths([{ label: spec.baseLabel }, { label: spec.heightLabel }, { label: spec.topLabel }], true);
        case 'rhombus': {
            if (!rectangle && spec.shape !== 'parallelogram') return false;
            const offset = spec.shape === 'parallelogram' ? spec.offset ?? 0 : 0;
            const side = Math.hypot(offset, spec.height);
            // 相对坐标只用于核对画出的形状；斜菱形的垂直高不是完整边长。
            const sideLabels = [{ label: spec.baseLabel }, { label: spec.topLabel }];
            if (offset === 0) sideLabels.push({ label: spec.heightLabel });
            return Math.abs(spec.width - side) <= 0.02 * Math.max(spec.width, side)
                && validateFigureLengths(sideLabels, true);
        }
        case 'rectangle': return rectangle;
        case 'parallelogram': return rectangle || spec.shape === 'parallelogram';
        case 'triangle': {
            if (spec.shape !== 'triangle') return false;
            if (!expected.triangle) return true;
            const apexRatio = spec.apexRatio ?? 0.5;
            return validateFigureTriangle([
                { x: 0, y: 0 }, { x: spec.width, y: 0 }, { x: spec.width * apexRatio, y: spec.height },
            ], [
                [{ label: spec.baseLabel }],
                apexRatio === 1 ? [{ label: spec.heightLabel }] : [],
                apexRatio === 0 ? [{ label: spec.heightLabel }] : [],
            ], expected.triangle);
        }
        case 'trapezoid': return spec.shape === 'trapezoid';
        // 立体题可能只绘制一个面，不把立体形状强加给面积模板。
        default: return true;
    }
}

function matchesSolidShape(spec: Extract<FigureSpec, { type: 'solid_geometry' }>, expected: ExplicitQuestionShape): boolean {
    if (expected === 'cylinder' || expected === 'cone' || expected === 'sphere') return false;
    if (expected !== 'cube') return true;
    const maximum = Math.max(spec.width, spec.depth, spec.height);
    const tolerance = Math.max(0.01, maximum * 0.02);
    return Math.abs(spec.width - spec.depth) <= tolerance && Math.abs(spec.width - spec.height) <= tolerance
        && validateFigureLengths([{ label: spec.widthLabel }, { label: spec.depthLabel }, { label: spec.heightLabel }], true);
}

function matchesStackedSolidShape(spec: Extract<FigureSpec, { type: 'stacked_solid' }>, expected: ExplicitQuestionShape): boolean {
    if (expected === 'cuboid') return true;
    if (expected !== 'cube') return false;
    const isCube = (part: typeof spec.base) => {
        const maximum = Math.max(part.width, part.depth, part.height);
        const tolerance = Math.max(0.01, maximum * 0.02);
        return Math.abs(part.width - part.depth) <= tolerance
            && Math.abs(part.width - part.height) <= tolerance
            && validateFigureLengths([{ label: part.widthLabel }, { label: part.depthLabel }, { label: part.heightLabel }], true);
    };
    return isCube(spec.base) && isCube(spec.top);
}

function matchesArithmeticConstraint(
    figure: Extract<FigureSpec, { type: 'vertical_arithmetic' }>,
    constraint: FigureArithmeticConstraint,
): boolean {
    if (figure.operation !== constraint.operation) return false;
    if (constraint.top && !arithmeticOperandMatches(figure.top, constraint.top)) return false;
    if (constraint.bottom && !arithmeticOperandMatches(figure.bottom, constraint.bottom)) return false;
    if (constraint.topDigits && !arithmeticDigitCountMatches(figure.top, constraint.topDigits)) return false;
    if (constraint.bottomDigits && !arithmeticDigitCountMatches(figure.bottom, constraint.bottomDigits)) return false;
    return true;
}

/**
 * 只在题干按全部子图标签明确分段时校验各图；候选说法和不确定语境不建立约束。
 */
function splitFigureGroupQuestion(
    spec: Extract<FigureSpec, { type: 'figure_group' }>,
    questionText: string,
): Map<string, string> | null {
    if (GROUP_CANDIDATE_CONTEXT.test(questionText) || UNCERTAIN_ASSERTION_CONTEXT.test(questionText)
        || AMBIGUOUS_SHAPE_CONTEXT.test(questionText) || /["“”‘’「」『』`]/u.test(questionText)) return null;
    const labels = spec.figures.map(({ label }) => label);
    const labelPattern = labels
        .slice()
        .sort((first, second) => second.length - first.length)
        .map(escapeRegExp)
        .join('|');
    const spacedLabelPattern = labels
        .filter((label) => !/^[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*$/u.test(label))
        .slice()
        .sort((first, second) => second.length - first.length)
        .map(escapeRegExp)
        .join('|');
    const explicitLabelMarker = String.raw`(${labelPattern})(?:\s*(?:图)?中\s*[.、:]?|\s*(?:选项|图)?[.、:)])`;
    const spacedLabelMarker = spacedLabelPattern ? String.raw`|(${spacedLabelPattern})\s+` : '';
    const marker = new RegExp(
        String.raw`(?:^|[。;\n])\s*(?:(?:选项|图|option|figure)\s*)?(?:\(\s*(${labelPattern})\s*\)\s*[.、:]?|(?:${explicitLabelMarker}${spacedLabelMarker}))\s*`,
        'giu',
    );
    const matches = [...questionText.matchAll(marker)].map((match) => ({
        label: (match[1] ?? match[2] ?? match[3])!,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
    }));
    if (matches.length !== labels.length || new Set(matches.map(({ label }) => label.toLowerCase())).size !== labels.length) return null;
    const labelLookup = new Map(labels.map((label) => [label.toLowerCase(), label]));
    const clauses = new Map<string, string>();
    matches.forEach((match, index, ordered) => {
        const label = labelLookup.get(match.label.toLowerCase());
        if (!label) return;
        const nextStart = ordered[index + 1]?.start ?? questionText.length;
        clauses.set(label, questionText.slice(match.end, nextStart).trim());
    });
    return clauses.size === labels.length && [...clauses.values()].every((clause) => clause.length > 0) ? clauses : null;
}

function validateFigureGroupQuestionConsistency(
    spec: Extract<FigureSpec, { type: 'figure_group' }>,
    questionText: string,
): boolean {
    const clauses = splitFigureGroupQuestion(spec, questionText);
    if (!clauses) return true;
    return spec.figures.every((entry) => validateSingleFigureQuestionConsistency(entry.figure, clauses.get(entry.label)!, true));
}

function validateSingleFigureQuestionConsistency(
    spec: Exclude<FigureSpec, { type: 'figure_group' }>,
    questionText: string,
    strictMissingPoints = false,
): boolean {
    if (spec.type === 'solid_net') {
        // solid_net 目前只表达正方体展开图；明确的长方体展开图必须回退，待判断语境保持保守。
        return explicitNetShape(questionText) !== 'cuboid';
    }
    if (spec.type === 'fraction' && !validateFigureQuestionFraction(spec, questionText)) return false;
    if (spec.type === 'number_line' && !validateFigureQuestionNumberLine(spec, questionText, strictMissingPoints)) return false;
    if (spec.type === 'coordinate_plane' && !validateFigureQuestionCoordinates(spec, questionText, strictMissingPoints)) return false;
    if ((spec.type === 'basic_geometry' || spec.type === 'circle_geometry' || spec.type === 'coordinate_plane')
        && !validateFigureNamedLengthLabels(spec, questionText)) return false;
    if (spec.type === 'basic_geometry' && (!validateFigureNamedAngleLabels(spec, questionText)
        || !validateFigureNamedRelations(spec, questionText, strictMissingPoints)
        || !validateFigureBasicCircleNamedRelations(spec, questionText, strictMissingPoints))) return false;
    if (spec.type === 'circle_geometry' && !validateFigureCircleNamedRelations(spec, questionText, strictMissingPoints)) return false;
    const questionShape = uniqueQuestionShape(questionText);
    // 面积、立体和坐标模板没有可见的题目点名，不能冒充具名多边形。
    if (questionShape?.namedPoints && spec.type !== 'basic_geometry') return false;
    if (questionShape && spec.type === 'area_geometry') {
        return matchesAreaShape(spec, questionShape)
            && validateFigureTemplateDimensions(spec, questionShape.shape, questionShape.dimensionText);
    }
    if (questionShape && spec.type === 'solid_geometry') {
        return matchesSolidShape(spec, questionShape.shape)
            && validateFigureTemplateDimensions(spec, questionShape.shape, questionShape.dimensionText);
    }
    if (questionShape && spec.type === 'stacked_solid') {
        return matchesStackedSolidShape(spec, questionShape.shape);
    }
    if (questionShape && spec.type === 'round_solid') {
        return questionShape.shape === spec.shape
            && validateFigureTemplateDimensions(spec, questionShape.shape, questionShape.dimensionText);
    }
    if (questionShape && spec.type === 'sphere_geometry') {
        return questionShape.shape === 'sphere'
            && validateFigureTemplateDimensions(spec, questionShape.shape, questionShape.dimensionText);
    }
    if (questionShape && spec.type === 'basic_geometry' && questionShape.shape !== 'cube' && questionShape.shape !== 'cuboid'
        && questionShape.shape !== 'cylinder' && questionShape.shape !== 'cone' && questionShape.shape !== 'sphere') {
        return validateFigurePolygonShape(spec, questionShape.shape, questionShape.triangle, questionShape.namedPoints);
    }
    if (spec.type !== 'vertical_arithmetic') return true;
    return extractFigureArithmeticConstraints(questionText).every((constraint) => matchesArithmeticConstraint(spec, constraint));
}

/** 只核对明确算式、位数、点位及主图声明，不推断故事关系或局部图形。 */
export function validateFigureQuestionConsistency(spec: FigureSpec, questionText?: string | null): boolean {
    if (!questionText?.trim()) return true;
    const normalizedQuestion = normalizeQuestionText(questionText);
    return spec.type === 'figure_group'
        ? validateFigureGroupQuestionConsistency(spec, normalizedQuestion)
        : validateSingleFigureQuestionConsistency(spec, normalizedQuestion);
}

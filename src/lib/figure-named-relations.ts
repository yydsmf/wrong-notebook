import type { FigureSpec } from './figure-spec';
import { isCirclePointOnArc, resolveCircleArcDelta } from './circle-arc';
import { validateFigureAngleLabels, validateFigureLengths } from './figure-measurements';

type BasicGeometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
type CircleGeometry = Extract<FigureSpec, { type: 'circle_geometry' }>;
type Point = BasicGeometry['points'][number];
type CirclePoint = BasicGeometry['points'][number];
type CircleAngleMode = 'generic' | 'center' | 'inscribed';
type CircleArcKind = 'any' | 'minor' | 'major' | 'semicircle';
type CircleSegmentKind = 'segment' | 'chord' | 'diameter' | 'radius';
type CircleScope = { center: CirclePoint; circle?: BasicGeometry['circles'][number] };

type NamedRelation =
    | { kind: 'missing_point' }
    | { kind: 'segment'; points: [Point, Point] }
    | { kind: 'angle'; points: [Point, Point, Point]; right: boolean }
    | { kind: 'parallel' | 'perpendicular'; first: [Point, Point]; second: [Point, Point] };

type CircleNamedRelation = {
    kind: 'missing_point';
    skipBasicCircleCheck?: boolean;
} | {
    kind: CircleSegmentKind;
    points: [CirclePoint, CirclePoint];
    scope?: CircleScope;
} | {
    kind: 'angle';
    points: [CirclePoint, CirclePoint, CirclePoint];
    mode: CircleAngleMode;
    right: boolean;
    scope?: CircleScope;
} | {
    kind: 'arc';
    points: [CirclePoint, CirclePoint];
    through?: CirclePoint;
    arcType: CircleArcKind;
    scope?: CircleScope;
} | {
    kind: 'sector';
    points: [CirclePoint, CirclePoint, CirclePoint];
    scope?: CircleScope;
};

const POINT_NAME = /^[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*$/u;
const POINT_TOKEN = String.raw`[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*`;
const POINT_SEQUENCE_END = String.raw`(?![A-Za-z0-9₀-₉'′″]|\s+${POINT_TOKEN}(?![A-Za-z0-9₀-₉'′″]))`;
const POINT_SEQUENCE_START = String.raw`(?<![A-Za-z0-9₀-₉'′″])`;
const SEGMENT_NAME = String.raw`${POINT_TOKEN}\s*${POINT_TOKEN}`;
const PRECEDING_POINT = new RegExp(String.raw`(?:^|[^A-Za-z0-9₀-₉'′″])${POINT_TOKEN}\s+$`, 'u');
const ANGLE_PATTERN = new RegExp(String.raw`(?:∠\s*|(?:角|\bangle\b)\s*)(${POINT_TOKEN}(?:\s*${POINT_TOKEN}){2})${POINT_SEQUENCE_END}`, 'giu');
const ANGLE_COPULA = String.raw`\s*(?:(?:是|为|等于|=|is\b|equals\b|measures\b)\s*)?(?:(?:一个|a\b|an\b|the\b)\s*)?`;
const RIGHT_ANGLE_DESCRIPTION = String.raw`(?:直角|right\s+angle\b|(?<![\d.])90(?:\.0+)?\s*(?:°|度|degrees?\b))`;
const RIGHT_ANGLE_SUFFIX = new RegExp(String.raw`^${ANGLE_COPULA}(?:(?:圆心角|圆周角|central\s+angle|inscribed\s+angle)\s*(?:且|并且|同时|and|also)\s*${ANGLE_COPULA})?${RIGHT_ANGLE_DESCRIPTION}`, 'iu');
const TOKEN = String.raw`[A-Za-z0-9₀-₉'′″]+(?:\s+[A-Za-z0-9₀-₉'′″]+)*`;
const CIRCLE_SCOPE_PREFIX = String.raw`(?:^|[,，:：])\s*(?:(?:在|已知)\s*|(?:in|within)\s+(?:the\s+)?)?`;
const CIRCLE_SCOPE_SUFFIX = String.raw`\s*(?:中|内部|内|里面|里|的|上)?(?=\s*(?:[,，:：]|$|半径|弦|直径|(?:圆心|圆周)?角|∠|优弧|劣弧|半圆|弧|扇形|\b(?:radius|chord|diameter|central\s+angle|inscribed\s+angle|major\s+arc|minor\s+arc|semicircle|arc|sector)\b))`;
const CIRCLE_SCOPE_PATTERN = new RegExp(`${CIRCLE_SCOPE_PREFIX}((?:圆\\s*|⊙\\s*|circle\\s+)(${POINT_TOKEN})(?![A-Za-z0-9₀-₉'′″]))${CIRCLE_SCOPE_SUFFIX}`, 'giu');
const RELATION_TOLERANCE = 0.03;
const UNCERTAIN_RELATION_CONTEXT = /是否|是不是|判断|能否|请问|试问|证明|猜测|认为|声称|如果|假设|假如|若|并非|不是|不为|不一定|未必|[“”「」『』"]|\b(?:whether|if|unless|prove|show|assum\w*|suppos\w*|determine|decide|judge|claims?|says?|not|could|might|may)\b|\bis\s+it\s+true\s+that\b|^\s*(?:is|are)(?:\s+the)?\s*$/iu;
const LENGTH_NUMBER = String.raw`[+−-]?(?:(?:\d+(?:\s+|又))?\d+\s*/\s*\d+|\d+(?:\.\d+)?|\.\d+)`;
const LENGTH_UNIT = String.raw`毫米|厘米|分米|千米|公里|米|mm|cm|dm|km|m`;
const LENGTH_ASSERTION = new RegExp(String.raw`${POINT_SEQUENCE_START}(${SEGMENT_NAME})${POINT_SEQUENCE_END}\s*(?:(?:的)?长(?:度)?\s*(?:(?:为|是|等于|=|:)\s*)?|(?:为|是|等于|=)\s*|\bhas\s+(?:a\s+)?length\s+(?:of\s+)?|\b(?:is|equals|measures)\s+)(${LENGTH_NUMBER}\s*(?:${LENGTH_UNIT})?)`, 'giu');
const LENGTH_CANDIDATE_CONTEXT = /下列|下述|以下说法|选项|正误|对错|\b(?:which|choose|select|statements?|true\s+or\s+false)\b/iu;
const ANGLE_VALUE_SUFFIX = new RegExp(String.raw`^\s*(?:(?:的(?:度数|大小)|度数)\s*)?(?:(?:是|为|等于|=|is\b|equals\b|measures\b)\s*)?(${LENGTH_NUMBER}\s*(?:°|度|degrees?\b))`, 'iu');
const ANGLE_OTHER_FIGURE_CONTEXT = /另(?:外)?一?(?:幅|张|个)?图(?:形)?|(?:其他|其它|第二|第三)(?:一|的)?(?:幅|张|个)?图(?:形)?|\b(?:another|other|second|third)\s+(?:diagram|figure|drawing|picture)\b/iu;
const ANGLE_MULTIPLE_FIGURE_CONTEXT = /[两二三多](?:幅|张|个)?图(?:形)?|\b(?:two|three|multiple|several)\s+(?:diagrams|figures|drawings|pictures)\b/iu;
const ANGLE_POSTPOSED_OTHER_FIGURE = new RegExp(String.raw`^\s*[,，]?\s*(?:在|于|\bin\s+)(?:the\s+)?(?:${ANGLE_OTHER_FIGURE_CONTEXT.source})(?:中|内)?\s*(?:$|[。;；!?！？]|\.(?=\s|$))`, 'iu');

function parsePointSequence(token: string, names: readonly string[], count: 1 | 2 | 3): string[] | null {
    const compact = token.replace(/\s+/gu, '');
    const candidates = names.slice().sort((first, second) => second.length - first.length);
    const solutions: string[][] = [];
    const visit = (offset: number, parts: string[]) => {
        if (solutions.length > 1) return;
        if (parts.length === count) {
            if (offset === compact.length) solutions.push(parts);
            return;
        }
        for (const name of candidates) {
            if (compact.startsWith(name, offset)) visit(offset + name.length, [...parts, name]);
        }
    };
    visit(0, []);
    return solutions.length === 1 ? solutions[0]! : null;
}

function parseVisiblePointSequence(token: string, count: 1 | 2 | 3): string[] | null {
    const compact = token.replace(/\s+/gu, '');
    const names = compact.match(new RegExp(POINT_TOKEN, 'gu'));
    return names && names.length === count && names.join('') === compact && names.every((name) => POINT_NAME.test(name))
        ? names
        : null;
}

function hasMissingNamedPoint(token: string, names: readonly string[], count: 1 | 2 | 3, strictMissingPoints = false): boolean {
    const references = parseVisiblePointSequence(token, count);
    return Boolean(references && references.some((name) => !names.includes(name))
        && (strictMissingPoints || references.some((name) => names.includes(name))));
}

function hasPointReference(token: string, names: readonly string[], count: 1 | 2 | 3, strictMissingPoints: boolean): boolean {
    const references = parseVisiblePointSequence(token, count);
    return Boolean(references && (strictMissingPoints || references.some((name) => names.includes(name))));
}

function explicitCircleScope(
    name: string,
    points: Map<string, CirclePoint>,
    circles: readonly CircleScope[],
): CircleScope | null | undefined {
    const named = circles.filter((scope) => scope.circle?.label?.trim() === name);
    if (named.length) return named.length === 1 ? named[0] : null;
    const centerName = name.match(new RegExp(String.raw`^(?:圆\s*|⊙\s*|circle\s+)(${POINT_TOKEN})$`, 'iu'))?.[1];
    if (!centerName) return undefined;
    const center = points.get(centerName);
    return center ? { center } : null;
}

function circleScopeAt(
    questionText: string,
    relationStart: number,
    points: Map<string, CirclePoint>,
    circles: readonly CircleScope[] = [],
): CircleScope | null | undefined {
    const preceding = questionText.slice(0, relationStart);
    const boundary = [...preceding.matchAll(/[。！？!?；;\n]|\.(?=\s|$)/gu)].at(-1);
    const prefix = preceding.slice(boundary ? boundary.index + boundary[0].length : 0);
    const candidates: Array<{ index: number; length: number; named: boolean; scope: CircleScope | null }> = [];
    for (const match of prefix.matchAll(CIRCLE_SCOPE_PATTERN)) {
        const center = points.get(match[2]!);
        candidates.push({ index: match.index, length: match[1]!.length, named: false, scope: center ? { center } : null });
    }
    for (const scope of circles) {
        const label = scope.circle?.label?.trim();
        if (!label) continue;
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const labelPattern = new RegExp(`${CIRCLE_SCOPE_PREFIX}(${escapedLabel})${CIRCLE_SCOPE_SUFFIX}`, 'giu');
        for (const match of prefix.matchAll(labelPattern)) {
            if (match[1] !== label) continue;
            candidates.push({ index: match.index, length: label.length, named: true, scope });
        }
    }
    const latestIndex = candidates.length ? Math.max(...candidates.map(({ index }) => index)) : -1;
    if (latestIndex < 0) return undefined;
    const latest = candidates.filter(({ index }) => index === latestIndex);
    const longest = Math.max(...latest.map(({ length }) => length));
    const exact = latest.filter(({ length }) => length === longest);
    const named = exact.filter((candidate) => candidate.named);
    const preferred = named.length ? named : exact;
    // 完整圆名优先；同名对应多个实际圆时拒绝，不凭半径替题目选圆。
    return preferred.length === 1 ? preferred[0]!.scope : null;
}

function pointMap(spec: BasicGeometry): Map<string, Point> {
    return new Map(spec.points.flatMap((point) => point.label && POINT_NAME.test(point.label)
        ? [[point.label, point] as const] : []));
}

function circlePointMap(spec: CircleGeometry): Map<string, CirclePoint> {
    return new Map([spec.center, ...spec.points].flatMap((point) => point.label && POINT_NAME.test(point.label)
        ? [[point.label, point] as const] : []));
}

function basicCirclePointMap(spec: BasicGeometry): Map<string, CirclePoint> {
    return pointMap(spec);
}

function segmentPair(spec: BasicGeometry, first: Point, second: Point): boolean {
    const hasPair = (from: string, to: string) => spec.segments.some((segment) =>
        (segment.from === from && segment.to === to) || (segment.from === to && segment.to === from));
    if (hasPair(first.id, second.id)) return true;
    return spec.polygons.some((polygon) => polygon.points.some((id, index) => {
        const next = polygon.points[(index + 1) % polygon.points.length]!;
        return (id === first.id && next === second.id) || (id === second.id && next === first.id);
    }));
}

function vector(first: Point, second: Point): { x: number; y: number } {
    return { x: second.x - first.x, y: second.y - first.y };
}

function hasParallel(first: [Point, Point], second: [Point, Point]): boolean {
    const a = vector(...first);
    const b = vector(...second);
    const firstLength = Math.hypot(a.x, a.y);
    const secondLength = Math.hypot(b.x, b.y);
    return firstLength > 0 && secondLength > 0
        && Math.abs(a.x * b.y - a.y * b.x) <= RELATION_TOLERANCE * firstLength * secondLength;
}

function hasPerpendicular(first: [Point, Point], second: [Point, Point]): boolean {
    const a = vector(...first);
    const b = vector(...second);
    const firstLength = Math.hypot(a.x, a.y);
    const secondLength = Math.hypot(b.x, b.y);
    return firstLength > 0 && secondLength > 0
        && Math.abs(a.x * b.x + a.y * b.y) <= RELATION_TOLERANCE * firstLength * secondLength;
}

/** 只把紧邻该角名的肯定直角声明作为约束，不扫描后续其它角的说明。 */
function hasExplicitRightAngle(questionText: string, match: RegExpMatchArray): boolean {
    const index = match.index!;
    const before = questionText.slice(0, index).split(/[,，。;；!?！？\n]|\.(?=\s|$)/u).at(-1) ?? '';
    const after = questionText.slice(index + match[0].length);
    if (UNCERTAIN_RELATION_CONTEXT.test(before)) return false;
    const assertion = after.match(RIGHT_ANGLE_SUFFIX);
    const prefixRight = /直角\s*$/u.test(before)
        || /^角/u.test(match[0]) && /直$/u.test(before)
        || /(?<![\d.])90(?:\.0+)?\s*(?:°|度)(?:的)?\s*$/u.test(before)
        || /(?<![\d.])90(?:\.0+)?\s+degrees?\s+$/iu.test(before)
        || /^angle\b/iu.test(match[0]) && /\bright\s+$/iu.test(before);
    if (!assertion && !prefixRight) return false;
    const tail = assertion ? after.slice(assertion[0].length) : after;
    return !/^\s*(?:吗|么|呢|[?？]|is\s+(?:it|this|that)\b|true\s+or\s+false\b|[+−\-*/÷×])/iu.test(tail);
}

function extractRelations(questionText: string, points: Map<string, Point>, strictMissingPoints: boolean): NamedRelation[] {
    const names = [...points.keys()];
    const relations: NamedRelation[] = [];
    const addSegment = (token: string) => {
        const parsed = parsePointSequence(token, names, 2);
        if (!parsed) {
            if (hasMissingNamedPoint(token, names, 2, strictMissingPoints)) relations.push({ kind: 'missing_point' });
            return;
        }
        const first = points.get(parsed[0]!);
        const second = points.get(parsed[1]!);
        if (first && second) relations.push({ kind: 'segment', points: [first, second] });
    };
    const addConnectedSegments = (firstToken: string, secondToken: string) => {
        const firstSegment = parsePointSequence(firstToken, names, 2);
        const secondSegment = parsePointSequence(secondToken, names, 2);
        if (firstSegment || secondSegment) {
            if (firstSegment && secondSegment) {
                addSegment(firstToken);
                addSegment(secondToken);
            } else relations.push({ kind: 'missing_point' });
            return;
        }
        if (parsePointSequence(firstToken, names, 1) && parsePointSequence(secondToken, names, 1)) {
            addSegment(firstToken + secondToken);
        } else if (hasPointReference(firstToken, names, 1, strictMissingPoints) || hasPointReference(secondToken, names, 1, strictMissingPoints)) {
            relations.push({ kind: 'missing_point' });
        }
    };
    const addPairRelation = (kind: 'parallel' | 'perpendicular', firstToken: string, secondToken: string) => {
        const firstNames = parsePointSequence(firstToken, names, 2);
        const secondNames = parsePointSequence(secondToken, names, 2);
        if (!firstNames || !secondNames) {
            if (hasPointReference(firstToken, names, 2, strictMissingPoints) || hasPointReference(secondToken, names, 2, strictMissingPoints)) {
                relations.push({ kind: 'missing_point' });
            }
            return;
        }
        const first = firstNames.map((name) => points.get(name));
        const second = secondNames.map((name) => points.get(name));
        if (first.every(Boolean) && second.every(Boolean)) {
            relations.push({ kind, first: first as [Point, Point], second: second as [Point, Point] });
        }
    };

    for (const match of questionText.matchAll(ANGLE_PATTERN)) {
        const parsed = parsePointSequence(match[1]!, names, 3);
        if (!parsed) {
            if (hasMissingNamedPoint(match[1]!, names, 3, strictMissingPoints)) relations.push({ kind: 'missing_point' });
            continue;
        }
        const anglePoints = parsed.map((name) => points.get(name));
        if (!anglePoints.every(Boolean)) continue;
        const right = hasExplicitRightAngle(questionText, match);
        relations.push({ kind: 'angle', points: anglePoints as [Point, Point, Point], right });
    }

    const segmentPattern = new RegExp(String.raw`(?:连接|线段|边|直线|射线|延长(?:线)?|segment|line|ray)\s*(${TOKEN})`, 'giu');
    for (const match of questionText.matchAll(segmentPattern)) addSegment(match[1]!);
    const joinedSegmentPattern = new RegExp(String.raw`(?:连接|connect)\s*(?:点|point\s*)?(${TOKEN})\s*(?:和|与|、|and)\s*(?:点|point\s*)?(${TOKEN})`, 'giu');
    for (const match of questionText.matchAll(joinedSegmentPattern)) {
        addConnectedSegments(match[1]!, match[2]!);
    }
    const lengthPattern = new RegExp(String.raw`(${TOKEN})\s*(?:的)?(?:长度|长)`, 'giu');
    for (const match of questionText.matchAll(lengthPattern)) addSegment(match[1]!);

    const pairPattern = new RegExp(String.raw`(${TOKEN})\s*(∥|//|⊥|平行|垂直)\s*(${TOKEN})`, 'giu');
    for (const match of questionText.matchAll(pairPattern)) {
        addPairRelation(/⊥|垂直/iu.test(match[2]!) ? 'perpendicular' : 'parallel', match[1]!, match[3]!);
    }
    const joinedPairPattern = new RegExp(String.raw`(${TOKEN})\s*(?:与|和)\s*(${TOKEN})\s*(平行|垂直)`, 'giu');
    for (const match of questionText.matchAll(joinedPairPattern)) {
        addPairRelation(/垂直/iu.test(match[3]!) ? 'perpendicular' : 'parallel', match[1]!, match[2]!);
    }

    // 等式只在题干明确出现图形语境时作为线段引用，避免把代数变量误判为图形关系。
    if (/[图形线段边三角形四边形角]/u.test(questionText)) {
        const equalPattern = new RegExp(String.raw`(${TOKEN})\s*(?:=|等于|相等)\s*(${TOKEN})`, 'giu');
        for (const match of questionText.matchAll(equalPattern)) {
            addSegment(match[1]!);
            addSegment(match[2]!);
        }
    }
    return relations;
}

function extractCircleRelations(
    questionText: string,
    points: Map<string, CirclePoint>,
    strictMissingPoints: boolean,
    circles: readonly CircleScope[] = [],
): CircleNamedRelation[] {
    const names = [...points.keys()];
    const relations: CircleNamedRelation[] = [];
    const add = (kind: CircleSegmentKind, token: string, circleScope?: CircleScope | null) => {
        if (circleScope === null) {
            relations.push({ kind: 'missing_point' });
            return;
        }
        const parsed = parsePointSequence(token, names, 2);
        if (!parsed) {
            if (hasMissingNamedPoint(token, names, 2, strictMissingPoints)) relations.push({ kind: 'missing_point' });
            return;
        }
        const first = points.get(parsed[0]!);
        const second = points.get(parsed[1]!);
        if (first && second) relations.push({ kind, points: [first, second], ...(circleScope ? { scope: circleScope } : {}) });
    };
    const addConnectedSegments = (firstToken: string, secondToken: string) => {
        const firstSegment = parsePointSequence(firstToken, names, 2);
        const secondSegment = parsePointSequence(secondToken, names, 2);
        if (firstSegment || secondSegment) {
            if (firstSegment && secondSegment) {
                add('segment', firstToken);
                add('segment', secondToken);
            } else relations.push({ kind: 'missing_point' });
            return;
        }
        if (parsePointSequence(firstToken, names, 1) && parsePointSequence(secondToken, names, 1)) {
            add('segment', firstToken + secondToken);
        } else if (hasPointReference(firstToken, names, 1, strictMissingPoints) || hasPointReference(secondToken, names, 1, strictMissingPoints)) {
            relations.push({ kind: 'missing_point' });
        }
    };
    const addAngle = (token: string, mode: CircleAngleMode, right: boolean, circleScope?: CircleScope | null) => {
        if (circleScope === null) {
            relations.push({ kind: 'missing_point' });
            return;
        }
        const parsed = parsePointSequence(token, names, 3);
        if (!parsed) {
            if (hasMissingNamedPoint(token, names, 3, strictMissingPoints)) relations.push({ kind: 'missing_point' });
            return;
        }
        const anglePoints = parsed.map((name) => points.get(name));
        if (anglePoints.every(Boolean)) {
            relations.push({ kind: 'angle', points: anglePoints as [CirclePoint, CirclePoint, CirclePoint], mode, right,
                ...(circleScope ? { scope: circleScope } : {}) });
        }
    };
    const addArc = (token: string, arcType: CircleArcKind, circleScope?: CircleScope | null) => {
        if (circleScope === null) {
            relations.push({ kind: 'missing_point', skipBasicCircleCheck: true });
            return;
        }
        const parsed = parsePointSequence(token, names, 3) ?? parsePointSequence(token, names, 2);
        if (!parsed) {
            if (hasMissingNamedPoint(token, names, 3, strictMissingPoints) || hasMissingNamedPoint(token, names, 2, strictMissingPoints)) {
                relations.push({ kind: 'missing_point', skipBasicCircleCheck: true });
            }
            return;
        }
        if (new Set(parsed).size !== parsed.length) {
            relations.push({ kind: 'missing_point', skipBasicCircleCheck: true });
            return;
        }
        const from = points.get(parsed[0]!);
        const to = points.get(parsed.length === 3 ? parsed[2]! : parsed[1]!);
        const through = parsed.length === 3 ? points.get(parsed[1]!) : undefined;
        if (from && to && (parsed.length === 2 || through)) {
            relations.push({ kind: 'arc', points: [from, to], arcType,
                ...(through ? { through } : {}), ...(circleScope ? { scope: circleScope } : {}) });
        }
    };
    const addSector = (token: string, circleScope?: CircleScope | null) => {
        if (circleScope === null) {
            relations.push({ kind: 'missing_point', skipBasicCircleCheck: true });
            return;
        }
        const parsed = parsePointSequence(token, names, 3);
        if (!parsed) {
            if (hasMissingNamedPoint(token, names, 3, strictMissingPoints)) {
                relations.push({ kind: 'missing_point', skipBasicCircleCheck: true });
            }
            return;
        }
        const from = points.get(parsed[0]!);
        const center = points.get(parsed[1]!);
        const to = points.get(parsed[2]!);
        if (from && center && to) relations.push({ kind: 'sector', points: [from, center, to], ...(circleScope ? { scope: circleScope } : {}) });
    };

    const circleLabels = circles.flatMap((scope) => scope.circle?.label?.trim() ? [scope.circle.label.trim()] : [])
        .sort((first, second) => second.length - first.length)
        .map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
    const circleName = String.raw`(?:${[...circleLabels, String.raw`(?:圆\s*|⊙\s*|circle\s+)${POINT_TOKEN}`].join('|')})${POINT_SEQUENCE_END}`;
    const postposedCirclePattern = new RegExp(String.raw`^\s*(?:(?:是|为|属于|位于|在)\s*|\b(?:belongs\s+to|lies\s+on|of)\s+|\bis\s+(?:in|on|of)\s+|\bis\s+(?:(?:a|an|the)\s+)?(?:(?:major|minor)\s+)?(?:arc|sector|central\s+angle|inscribed\s+angle)\s+of\s+)(?:the\s+)?(${circleName})`, 'iu');
    const circleScopeAfterRelation = (start: number, end: number) => {
        const prefixScope = circleScopeAt(questionText, start, points, circles);
        const after = questionText.slice(end);
        const suffix = after.match(postposedCirclePattern);
        if (!suffix) return { scope: prefixScope };
        const before = questionText.slice(0, start).split(/[。！？!?；;\n]|\.(?=\s|$)/u).at(-1) ?? '';
        const tail = after.slice(suffix[0].length);
        const tailClause = tail.split(/[。！？!?；;\n]/u)[0]?.trim() ?? '';
        if (UNCERTAIN_RELATION_CONTEXT.test(before)
            || /(?:吗|么|呢|[?？])\s*$/u.test(tailClause)
            || /[,，]\s*(?:对吗|对不对|正确吗|is\s+(?:it|this|that)\b|true\s+or\s+false\b)\s*$/iu.test(tailClause)) {
            return { scope: prefixScope };
        }
        const suffixArcType = /\bmajor\s+arc\b/iu.test(suffix[0]) || /^\s*(?:的\s*)?优弧/u.test(tail)
            ? 'major'
            : /\bminor\s+arc\b/iu.test(suffix[0]) || /^\s*(?:的\s*)?劣弧/u.test(tail)
                ? 'minor'
                : /\bsemicircle\b/iu.test(suffix[0]) || /^\s*(?:的\s*)?半圆/u.test(tail) ? 'semicircle' : undefined;
        return { scope: explicitCircleScope(suffix[1]!, points, circles), ...(suffixArcType ? { arcType: suffixArcType as CircleArcKind } : {}) };
    };

    for (const match of questionText.matchAll(ANGLE_PATTERN)) {
        const index = match.index ?? 0;
        const clauseStart = Math.max(
            questionText.lastIndexOf('，', index), questionText.lastIndexOf(',', index),
            questionText.lastIndexOf('；', index), questionText.lastIndexOf(';', index),
            questionText.lastIndexOf('。', index), questionText.lastIndexOf('\n', index),
        ) + 1;
        const clauseEndCandidates = ['，', ',', '；', ';', '。', '\n']
            .map((separator) => questionText.indexOf(separator, index + match[0].length))
            .filter((position) => position >= 0);
        const clauseEnd = clauseEndCandidates.length ? Math.min(...clauseEndCandidates) : questionText.length;
        const before = questionText.slice(clauseStart, index + 1);
        const semanticPrefix = /^angle\s/iu.test(match[0]!) ? before.slice(0, -1) : before;
        const after = questionText.slice(index + match[0].length, clauseEnd);
        const suffixModeMatch = after.match(new RegExp(String.raw`^\s*(?:是|为|属于|is(?:\s+(?:a|an|the))?)\s*(?:一个\s*)?(?:${circleName}\s*的\s*)?(圆心角|圆周角|central\s+angle|inscribed\s+angle)`, 'iu'));
        const suffixModeTail = suffixModeMatch ? after.slice(suffixModeMatch[0].length) : '';
        const suffixModeIsQuestion = /(?:吗|么|呢|[?？])\s*$/u.test(suffixModeTail.trim())
            || /[,，]\s*(?:对吗|对不对|正确吗)\s*$/u.test(suffixModeTail);
        const uncertainMode = UNCERTAIN_RELATION_CONTEXT.test(before) || suffixModeIsQuestion;
        const suffixMode = uncertainMode ? '' : suffixModeMatch?.[1] ?? '';
        const mode: CircleAngleMode = !uncertainMode && (/圆心角\s*$|central\s*$/iu.test(semanticPrefix)
            || /圆心角|central\s+angle/iu.test(suffixMode)) ? 'center'
            : !uncertainMode && (/圆周角\s*$|inscribed\s*$/iu.test(semanticPrefix)
                || /圆周角|inscribed\s+angle/iu.test(suffixMode)) ? 'inscribed' : 'generic';
        addAngle(match[1]!, mode, hasExplicitRightAngle(questionText, match), circleScopeAfterRelation(index, index + match[0].length).scope);
    }

    const arcPattern = new RegExp(String.raw`(?:优弧|劣弧|半圆|弧|\b(?:major\s+arc|minor\s+arc|semicircle|arc)\b)\s*(${POINT_TOKEN}(?:\s*${POINT_TOKEN}){1,2})${POINT_SEQUENCE_END}`, 'giu');
    for (const match of questionText.matchAll(arcPattern)) {
        const word = match[0]!.toLowerCase();
        const arcType: CircleArcKind = /优弧|major\s+arc/iu.test(word)
            ? 'major'
            : /劣弧|minor\s+arc/iu.test(word)
                ? 'minor'
                : /半圆|semicircle/iu.test(word) ? 'semicircle' : 'any';
        const start = match.index ?? 0;
        const postposed = circleScopeAfterRelation(start, start + match[0].length);
        if (postposed.arcType && arcType !== 'any' && postposed.arcType !== arcType) {
            addArc(match[1]!, arcType, null);
        } else {
            addArc(match[1]!, postposed.arcType ?? arcType, postposed.scope);
        }
    }

    const sectorPattern = new RegExp(String.raw`(?:扇形|\bsector\b)\s*(${POINT_TOKEN}(?:\s*${POINT_TOKEN}){2})${POINT_SEQUENCE_END}`, 'giu');
    for (const match of questionText.matchAll(sectorPattern)) {
        const start = match.index ?? 0;
        addSector(match[1]!, circleScopeAfterRelation(start, start + match[0].length).scope);
    }

    const addPrefixRelations = (kind: CircleSegmentKind, pattern: string) => {
        const expression = new RegExp(String.raw`(?:${pattern})\s*(${SEGMENT_NAME})${POINT_SEQUENCE_END}`, 'giu');
        for (const match of questionText.matchAll(expression)) {
            add(kind, match[1]!, circleScopeAt(questionText, match.index ?? 0, points, circles));
        }
    };

    addPrefixRelations('chord', String.raw`弦|\bchord\b`);
    addPrefixRelations('diameter', String.raw`直径|\bdiameter\b`);
    addPrefixRelations('radius', String.raw`半径|\bradius\b`);

    // 后置归属只约束当前关系，不把“AB是内圆的弦”变成后续所有关系的圆范围。
    const suffixPattern = new RegExp(String.raw`${POINT_SEQUENCE_START}(${SEGMENT_NAME})${POINT_SEQUENCE_END}\s*(?:是|为|属于|is\b(?:\s+(?:a|an|the)\b)?)\s*(?:一条|一段|一个)?\s*(?:(${circleName})\s*的\s*(?:一条|一段|一个)?\s*|圆的\s*)?(弦|直径|半径|\b(?:chord|diameter|radius)\b)(?:\s+of\s+(?:the\s+)?(${circleName}))?`, 'giu');
    for (const match of questionText.matchAll(suffixPattern)) {
        // 避免把“O B A是半径”的后两个点截出来，普通说明单词不属于点名。
        if (PRECEDING_POINT.test(questionText.slice(0, match.index))) continue;
        const before = questionText.slice(0, match.index).split(/[,，。;；!?！？\n]|\.(?=\s|$)/u).at(-1) ?? '';
        const after = questionText.slice(match.index + match[0].length);
        if (UNCERTAIN_RELATION_CONTEXT.test(before)
            || /^\s*(?:吗|么|呢|[?？]|[,，]\s*(?:对吗|对不对|正确吗)|is\s+(?:it|this|that)\b|true\s+or\s+false\b|如果|假设|若|\b(?:if|when)\b)/iu.test(after)) continue;
        const word = match[3]!.toLowerCase();
        const kind = /弦|chord/iu.test(word)
            ? 'chord'
            : /直径|diameter/iu.test(word) ? 'diameter' : 'radius';
        const localCircle = match[2] ?? match[4];
        const scope = localCircle
            ? explicitCircleScope(localCircle, points, circles)
            : circleScopeAt(questionText, match.index ?? 0, points, circles);
        add(kind, match[1]!, scope);
    }

    const segmentPattern = new RegExp(String.raw`(?:连接|线段|边|直线|射线|延长(?:线)?|segment|line|ray)\s*(${TOKEN})`, 'giu');
    for (const match of questionText.matchAll(segmentPattern)) add('segment', match[1]!);
    const joinedSegmentPattern = new RegExp(String.raw`(?:连接|connect)\s*(?:点|point\s*)?(${TOKEN})\s*(?:和|与|、|and)\s*(?:点|point\s*)?(${TOKEN})`, 'giu');
    for (const match of questionText.matchAll(joinedSegmentPattern)) {
        addConnectedSegments(match[1]!, match[2]!);
    }
    const lengthPattern = new RegExp(String.raw`(${TOKEN})\s*(?:的)?(?:长度|长|length)`, 'giu');
    for (const match of questionText.matchAll(lengthPattern)) add('segment', match[1]!);
    return relations;
}

function hasPointPair(items: readonly { from: string; to: string }[], first: CirclePoint, second: CirclePoint): boolean {
    return items.some((item) => (item.from === first.id && item.to === second.id)
        || (item.from === second.id && item.to === first.id));
}

function hasCircleRadius(spec: CircleGeometry, first: CirclePoint, second: CirclePoint): boolean {
    const circlePoint = first.id === spec.center.id ? second : second.id === spec.center.id ? first : null;
    return circlePoint !== null && spec.radii.some((item) => item.to === circlePoint.id);
}

function hasCircleArc(
    spec: CircleGeometry,
    relation: Extract<CircleNamedRelation, { kind: 'arc' }>,
): boolean {
    const [first, second] = relation.points;
    if (first.id === spec.center.id || second.id === spec.center.id || relation.through?.id === spec.center.id) return false;
    const collections = [...spec.arcs, ...spec.sectors];
    return collections.some((item) => {
        if (!hasPointPair([item], first, second)) return false;
        const from = spec.points.find((point) => point.id === item.from);
        const to = spec.points.find((point) => point.id === item.to);
        const itemThrough = item.through ? spec.points.find((point) => point.id === item.through) : undefined;
        if (!from || !to) return false;
        const delta = resolveCircleArcDelta(spec.center, from, to, {
            ...(item.arcType ? { arcType: item.arcType } : {}),
            ...(itemThrough ? { through: itemThrough } : {}),
        });
        if (delta === null) return false;
        if (relation.through && !isCirclePointOnArc(spec.center, from, delta, relation.through)) return false;
        const size = Math.abs(delta);
        if (relation.arcType === 'semicircle') return Math.abs(size - Math.PI) <= 0.0001 && Boolean(item.through);
        if (relation.arcType === 'major') return size > Math.PI + 0.0001;
        if (relation.arcType === 'minor') return size < Math.PI - 0.0001;
        return true;
    });
}

function hasCircleRelation(spec: CircleGeometry, relation: CircleNamedRelation): boolean {
    if (relation.kind === 'missing_point') return false;
    if (relation.scope && relation.scope.center.id !== spec.center.id) return false;
    if (relation.kind === 'arc') return hasCircleArc(spec, relation);
    if (relation.kind === 'sector') {
        const [first, center, second] = relation.points;
        return center.id === spec.center.id && spec.sectors.some((item) => hasPointPair([item], first, second));
    }
    if (relation.kind === 'angle') {
        const [first, vertex, second] = relation.points;
        if (relation.mode === 'center' && vertex.id !== spec.center.id) return false;
        if (relation.mode === 'inscribed' && vertex.id === spec.center.id) return false;
        const sectorDefinesRays = vertex.id === spec.center.id
            && hasPointPair(spec.sectors, first, second);
        if (sectorDefinesRays) return !relation.right || hasPerpendicular([first, vertex], [vertex, second]);
        const firstRay = hasCircleRelation(spec, { kind: 'segment', points: [first, vertex] });
        const secondRay = hasCircleRelation(spec, { kind: 'segment', points: [vertex, second] });
        if (!firstRay || !secondRay) return false;
        return !relation.right || hasPerpendicular([first, vertex], [vertex, second]);
    }
    const [first, second] = relation.points;
    if (relation.kind === 'radius') return hasCircleRadius(spec, first, second);
    if (relation.kind === 'diameter') return hasPointPair(spec.diameters, first, second);
    if (relation.kind === 'chord') return hasPointPair(spec.chords, first, second)
        || hasPointPair(spec.diameters, first, second);
    return hasCircleRadius(spec, first, second)
        || hasPointPair(spec.chords, first, second)
        || hasPointPair(spec.diameters, first, second);
}

function hasAngleRays(spec: BasicGeometry, angle: [Point, Point, Point]): boolean {
    return segmentPair(spec, angle[0], angle[1]) && segmentPair(spec, angle[1], angle[2]);
}

function pointLiesOnBasicCircle(point: Point, center: Point, radius: number): boolean {
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    return distance > 0 && Math.abs(distance - radius) <= Math.max(0.5, radius * 0.03);
}

function scopedBasicCircles(
    spec: BasicGeometry,
    scope?: CircleScope,
): BasicGeometry['circles'] {
    return spec.circles.filter((circle) => (!scope || circle.center === scope.center.id)
        && (!scope?.circle || circle === scope.circle));
}

function hasBasicCircleSegment(spec: BasicGeometry, relation: Extract<CircleNamedRelation, { kind: CircleSegmentKind }>): boolean {
    const [first, second] = relation.points;
    if (!segmentPair(spec, first, second)) return false;
    const centers = new Map(spec.points.map((point) => [point.id, point]));
    const circles = scopedBasicCircles(spec, relation.scope);
    if (relation.kind === 'radius') {
        return circles.some((circle) => {
            const center = centers.get(circle.center);
            return center && (first.id === center.id && pointLiesOnBasicCircle(second, center, circle.radius)
                || second.id === center.id && pointLiesOnBasicCircle(first, center, circle.radius));
        });
    }

    return circles.some((circle) => {
        const center = centers.get(circle.center);
        if (!center || !pointLiesOnBasicCircle(first, center, circle.radius)
            || !pointLiesOnBasicCircle(second, center, circle.radius)) return false;
        if (relation.kind !== 'diameter') return true;
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        return Math.hypot(midpoint.x - center.x, midpoint.y - center.y) <= Math.max(0.5, circle.radius * 0.03);
    });
}

function hasBasicCircleAngle(spec: BasicGeometry, relation: Extract<CircleNamedRelation, { kind: 'angle' }>): boolean {
    const [first, vertex, second] = relation.points;
    const hasRays = segmentPair(spec, first, vertex) && segmentPair(spec, vertex, second);
    if (!hasRays) return false;
    if (relation.mode === 'generic') return true;
    const centers = new Map(spec.points.map((point) => [point.id, point]));
    const circles = scopedBasicCircles(spec, relation.scope);
    if (relation.mode === 'center') {
        return circles.some((circle) => {
            const center = centers.get(circle.center);
            return center?.id === vertex.id
                && pointLiesOnBasicCircle(first, center, circle.radius)
                && pointLiesOnBasicCircle(second, center, circle.radius);
        });
    }
    return circles.some((circle) => {
        const center = centers.get(circle.center);
        return center && [first, vertex, second].every((point) => pointLiesOnBasicCircle(point, center, circle.radius));
    });
}

/** basic_geometry 只验证明确点名的圆线段与角，不推断圆弧、扇形或缺失线段。 */
export function validateFigureBasicCircleNamedRelations(spec: BasicGeometry, questionText: string, strictMissingPoints = false): boolean {
    const points = basicCirclePointMap(spec);
    const geometryPoints = new Map(spec.points.map((point) => [point.id, point]));
    const circles = spec.circles.flatMap((circle) => {
        const center = geometryPoints.get(circle.center);
        return center ? [{ center, circle }] : [];
    });
    if (points.size === 0 && !strictMissingPoints) return true;
    return extractCircleRelations(questionText, points, strictMissingPoints, circles).every((relation) => {
        if (relation.kind === 'missing_point') return relation.skipBasicCircleCheck === true;
        if (relation.kind === 'radius' || relation.kind === 'chord' || relation.kind === 'diameter') {
            return hasBasicCircleSegment(spec, relation);
        }
        if (relation.kind === 'angle' && relation.mode !== 'generic') return hasBasicCircleAngle(spec, relation);
        return true;
    });
}

/** 只校验题干明确写出的点名关系；无法唯一解析时保守跳过，不猜测图形。 */
export function validateFigureNamedRelations(spec: BasicGeometry, questionText: string, strictMissingPoints = false): boolean {
    const points = pointMap(spec);
    if (points.size === 0 && !strictMissingPoints) return true;
    for (const relation of extractRelations(questionText, points, strictMissingPoints)) {
        if (relation.kind === 'missing_point') return false;
        if (relation.kind === 'segment' && !segmentPair(spec, ...relation.points)) return false;
        if (relation.kind === 'angle') {
            if (!hasAngleRays(spec, relation.points)) return false;
            if (relation.right && !hasPerpendicular([relation.points[0], relation.points[1]], [relation.points[1], relation.points[2]])) return false;
        }
        if (relation.kind === 'parallel' && (!segmentPair(spec, ...relation.first) || !segmentPair(spec, ...relation.second)
            || !hasParallel(relation.first, relation.second))) return false;
        if (relation.kind === 'perpendicular' && (!segmentPair(spec, ...relation.first) || !segmentPair(spec, ...relation.second)
            || !hasPerpendicular(relation.first, relation.second))) return false;
    }
    return true;
}

/** 只校验圆图题干明确点名的线段、角、弧、扇形及圆心归属；无法唯一解析时保守跳过。 */
export function validateFigureCircleNamedRelations(spec: CircleGeometry, questionText: string, strictMissingPoints = false): boolean {
    const points = circlePointMap(spec);
    if (points.size === 0 && !strictMissingPoints) return true;
    return extractCircleRelations(questionText, points, strictMissingPoints).every((relation) => relation.kind !== 'missing_point' && hasCircleRelation(spec, relation));
}

/** 题干和图内同端点线段均有明确长度时精确比较，不从示意坐标推算或补写标注。 */
export function validateFigureNamedLengthLabels(
    spec: Extract<FigureSpec, { type: 'basic_geometry' | 'circle_geometry' | 'coordinate_plane' }>,
    questionText: string,
): boolean {
    if (LENGTH_CANDIDATE_CONTEXT.test(questionText)) return true;
    const figurePoints = spec.type === 'circle_geometry' ? [spec.center, ...spec.points] : spec.points;
    const points = new Map(figurePoints.flatMap((point) => point.label && POINT_NAME.test(point.label)
        ? [[point.label, point.id] as const] : []));
    const names = [...points.keys()];
    const segments = spec.type === 'circle_geometry'
        ? [...spec.chords, ...spec.diameters, ...spec.radii.map((item) => ({ ...item, from: spec.center.id }))]
        : spec.segments;
    for (const match of questionText.matchAll(LENGTH_ASSERTION)) {
        const start = match.index;
        if (PRECEDING_POINT.test(questionText.slice(0, start))) continue;
        const before = questionText.slice(0, start).split(/[。;；!?！？\n]|\.(?=\s|$)/u).at(-1) ?? '';
        const expressionBefore = before.replace(/(?:\$\$?|\\\(|\\\[)\s*$/u, '');
        const after = questionText.slice(start + match[0].length).replace(/^\s*(?:\$\$?|\\\)|\\\])/u, '');
        // 只核对独立的“点名=长度”；系数、运算符和连等式后的片段可能只是公式的一部分。
        if (/(?:[A-Za-z0-9₀-₉'′″]+|[)）])\s*(?:[+−\-*×÷/＝=]|\b(?:times|plus|minus|divided\s+by)\b)\s*$/iu.test(expressionBefore)
            || /\\[A-Za-z]*\s*$/u.test(expressionBefore)
            || /(?:^|\s)[+−\-*×÷/]\s*$/u.test(expressionBefore)
            || /[A-Za-z0-9₀-₉'′″]\s*[\^_]\s*$/u.test(expressionBefore)
            || /\d\s*$/u.test(expressionBefore)) continue;
        if (UNCERTAIN_RELATION_CONTEXT.test(before)
            || !/^\s*(?:$|[,，。;；!?！？\n]|\.(?!\d)|且|并且|\band\b)/iu.test(after)
            || /^\s*[,，]\s*\d/u.test(after)
            || /^\s*(?:吗|么|呢|[?？]|[,，]\s*(?:(?:这一|这|该)(?:句话|说法|结论))?\s*(?:对吗|对不对|正确吗|是否)|[,，]?\s*\b(?:if|when|true\s+or\s+false|is\s+this\s+true|correct)\b)/iu.test(after)) continue;
        const parsed = parsePointSequence(match[1]!, names, 2);
        if (!parsed) continue;
        const first = points.get(parsed[0]!);
        const second = points.get(parsed[1]!);
        const labelled = segments.filter((segment) => (segment.from === first && segment.to === second)
            || (segment.from === second && segment.to === first));
        if (labelled.length && !validateFigureLengths([...labelled, { label: match[2] }], true)) return false;
    }
    return true;
}

/** 同顶点、同两条角边的明确度数须一致；不按示意坐标测角或求解未知标注。 */
export function validateFigureNamedAngleLabels(spec: BasicGeometry, questionText: string): boolean {
    if (!spec.angles.length || LENGTH_CANDIDATE_CONTEXT.test(questionText) || ANGLE_MULTIPLE_FIGURE_CONTEXT.test(questionText)
        || /判断|正确|错误|[“”「」『』"`]/u.test(questionText)) return true;
    const points = pointMap(spec);
    const names = [...points.keys()];
    const otherFigure = questionText.search(ANGLE_OTHER_FIGURE_CONTEXT);
    const scoped = otherFigure < 0 ? questionText : questionText.slice(0, otherFigure);
    for (const match of scoped.matchAll(ANGLE_PATTERN)) {
        const afterName = questionText.slice(match.index! + match[0].length);
        const value = afterName.match(ANGLE_VALUE_SUFFIX);
        if (!value) continue;
        const before = questionText.slice(0, match.index).split(/[。;；!?！？\n]|\.(?=\s|$)/u).at(-1) ?? '';
        const expressionBefore = before.replace(/(?:\$\$?|\\\(|\\\[)\s*$/u, '');
        const after = afterName.slice(value[0].length).replace(/^\s*(?:\$\$?|\\\)|\\\])/u, '').replace(/^[\s)\]}）］｝】〕]+/u, '');
        if (UNCERTAIN_RELATION_CONTEXT.test(before) || /求证|假定|倘若|只要|只有|除非/u.test(before)
            || ANGLE_POSTPOSED_OTHER_FIGURE.test(after)
            || /[\d)}\]）］｝+−\-*×÷/^_=]\s*$/u.test(expressionBefore)
            || /\\[A-Za-z]*\s*$/u.test(expressionBefore)
            || /(?<![A-Za-z])[A-Za-z](?:[0-9₀-₉'′″]+)?\s*$/u.test(expressionBefore)
            || !/^\s*(?:$|[,，。;；!?！？\n]|\.(?!\d)|且|并且|\band\b)/iu.test(after)
            || /^\s*(?:吗|么|呢|[?？]|[,，]\s*(?:或|或者|\bor\b|(?:(?:这|这一|该)(?:句话|说法|结论))?\s*(?:对吗|对不对|正确吗|是否)|\b(?:if|when|correct|is\s+this\s+true)\b))/iu.test(after)) continue;
        const parsed = parsePointSequence(match[1]!, names, 3);
        if (!parsed) continue;
        const [first, vertex, second] = parsed.map((name) => points.get(name)!.id);
        const corresponding = spec.angles.filter((angle) => angle.vertex === vertex
            && ((angle.from === first && angle.to === second) || (angle.from === second && angle.to === first)));
        if (!corresponding.length) continue;
        const labels = corresponding.flatMap((angle) => [{ label: angle.label }, ...(angle.style === 'right' ? [{ label: '90°' }] : [])]);
        if (!validateFigureAngleLabels([...labels, { label: value[1] }])) return false;
    }
    return true;
}

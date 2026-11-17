import type { FigureSpec } from './figure-spec';
import { validateFigureLengths } from './figure-measurements';

type AreaGeometry = Extract<FigureSpec, { type: 'area_geometry' }>;
type SolidGeometry = Extract<FigureSpec, { type: 'solid_geometry' }>;
type StackedSolid = Extract<FigureSpec, { type: 'stacked_solid' }>;
type RoundSolid = Extract<FigureSpec, { type: 'round_solid' }>;
type SphereGeometry = Extract<FigureSpec, { type: 'sphere_geometry' }>;
type Dimension = 'length' | 'width' | 'height' | 'depth' | 'base' | 'upper' | 'lower' | 'side' | 'edge' | 'radius' | 'diameter' | 'slant';
type DimensionLabels = Partial<Record<Dimension, Array<string | undefined>>>;
type StackedLayer = 'base' | 'top';
interface DimensionAssertion { dimension: Dimension; value: string; layer?: StackedLayer }

const ROLES: Record<string, Dimension> = {
    长: 'length', 长度: 'length', length: 'length',
    宽: 'width', 宽度: 'width', width: 'width',
    高: 'height', 高度: 'height', height: 'height',
    深: 'depth', 深度: 'depth', depth: 'depth',
    底: 'base', 底边: 'base', 底边长: 'base', base: 'base',
    上底: 'upper', 下底: 'lower',
    边长: 'side', 'side length': 'side', side: 'side',
    棱长: 'edge', 'edge length': 'edge', edge: 'edge',
    半径: 'radius', 底面半径: 'radius', radius: 'radius', 'base radius': 'radius',
    直径: 'diameter', 底面直径: 'diameter', diameter: 'diameter', 'base diameter': 'diameter',
    母线: 'slant', 母线长: 'slant', 'slant height': 'slant',
};
const ROLE_PATTERN = String.raw`底面半径|底面直径|半径|直径|母线长|母线|上底|下底|底边长|底边|边长|棱长|长度|宽度|高度|深度|长|宽|高|深|底|\b(?:(?:base\s+)?radius|(?:base\s+)?diameter|slant\s+height|side\s+length|edge\s+length|length|width|height|depth|base|side|edge)\b`;
const NUMBER_PATTERN = String.raw`[+−-]?(?:(?:\d+(?:\s+|又))?\d+\s*/\s*\d+|\d+(?:\.\d+)?|\.\d+)`;
const VALUE_PATTERN = String.raw`${NUMBER_PATTERN}\s*(?:毫米|厘米|分米|千米|公里|米|mm|cm|dm|km|m)?`;
const DIMENSION_VALUE_PATTERN = new RegExp(String.raw`(${NUMBER_PATTERN})\s*(毫米|厘米|分米|千米|公里|米|mm|cm|dm|km|m)?`, 'giu');
const DIMENSION_LABEL_PREFIX = new RegExp(String.raw`^(${ROLE_PATTERN})\s*(?:(?:为|是|等于|[:：=＝]|\bis\b|\bof\b)\s*)?`, 'iu');
const DIMENSION_BOUNDARY = String.raw`(?:^|[\s,，。;；:：]|的|\(|\[|\{|（|［|｛|【|〔|(?<=\d)|(?<=米)|(?<=里)|(?<=m)|(?<=层))`;
const DIMENSION_PATTERN = new RegExp(String.raw`${DIMENSION_BOUNDARY}(?:(?:其|它的|该图的)\s*|(?:its|the)\s+)?(${ROLE_PATTERN})\s*(?:(?:为|是|等于|=|:|\bis\b|\bof\b)\s*)?(${VALUE_PATTERN})`, 'giu');
const NEXT_DIMENSION_PATTERN = new RegExp(String.raw`^\s*(?:${ROLE_PATTERN})`, 'iu');
const ROLE_TOKEN_PATTERN = String.raw`(?:${ROLE_PATTERN})`;
const RESPECTIVE_LIST_PATTERN = new RegExp(String.raw`(${ROLE_TOKEN_PATTERN}(?:[\s、,，和与及/&]*${ROLE_TOKEN_PATTERN}){1,3})\s*分别\s*(?:(?:为|是|等于|[:：=＝])\s*)?`, 'iu');
const ENGLISH_ROLE_PATTERN = String.raw`(?:(?:base\s+)?radius|(?:base\s+)?diameter|slant\s+height|side\s+length|edge\s+length|length|width|height|depth|base|side|edge)`;
const ENGLISH_ROLE_SEPARATOR = String.raw`(?:\s*,\s*(?:and\s+)?|\s+and\s+)`;
const ENGLISH_ROLE_LIST_PATTERN = String.raw`${ENGLISH_ROLE_PATTERN}(?:${ENGLISH_ROLE_SEPARATOR}${ENGLISH_ROLE_PATTERN}){1,3}`;
const ENGLISH_RESPECTIVE_LIST_PATTERN = new RegExp(String.raw`(${ENGLISH_ROLE_LIST_PATTERN})\s+(?:are|is)\s+(.+?)\s+respectively\b`, 'iu');
const UNCERTAIN_CONTEXT = /是否|是不是|判断|能否|请问|试问|证明|猜测|认为|声称|如果|假设|假如|若|并非|不是|不为|不一定|未必|[“”‘’「」『』"`]|\b(?:which|whether|if|when|unless|prove|show|assum\w*|suppos\w*|determine|decide|judge|claims?|says?|not|could|might|may)\b/iu;
const OTHER_FIGURE_CONTEXT = /另一个|另一(?:个|张|块|幅|种)|其他|其它|其余|第二|第三|下列|选项|候选|\b(?:another|other|second|third|options?|choose|select)\b/iu;
const STACKED_LAYER_SCOPE_PATTERN = /底层|下层|底部|下部|底物体|下方(?:物体|长方体)|上层|顶层|上部|顶部|上物体|顶物体|上方(?:物体|长方体)|\b(?:base|bottom|lower)\s+(?:layer|solid|cuboid|block)\b|\b(?:top|upper)\s+(?:layer|solid|cuboid|block)\b/giu;

function stackedLayerAt(text: string): StackedLayer | undefined {
    let layer: StackedLayer | undefined;
    for (const match of text.matchAll(STACKED_LAYER_SCOPE_PATTERN)) {
        layer = /^(?:上|顶)|\b(?:top|upper)\b/iu.test(match[0]) ? 'top' : 'base';
    }
    return layer;
}

function extractDimensions(text: string): DimensionAssertion[] {
    const otherFigure = text.search(OTHER_FIGURE_CONTEXT);
    const scoped = otherFigure < 0 ? text : text.slice(0, otherFigure);
    const assertions: DimensionAssertion[] = [];
    for (const sentence of scoped.split(/(?<=[。!?；;])|\.(?=\s|$)/u)) {
        const respective = extractRespectiveDimensions(sentence);
        if (respective) {
            assertions.push(...respective);
            continue;
        }
        let consumed = 0;
        for (const match of sentence.matchAll(DIMENSION_PATTERN)) {
            const before = sentence.slice(0, match.index);
            const after = sentence.slice(match.index + match[0].length);
            const afterDimensions = after.replace(/^[\s)\]}）］｝】〕]+/u, '');
            const continuesWithDimension = NEXT_DIMENSION_PATTERN.test(afterDimensions);
            // 只延续尺寸声明，不把后文新引入物体或辅助线的尺寸套给主图。
            if (!/^[\s,，:：]*(?:(?:with|and)\s*)?$/iu.test(sentence.slice(consumed, match.index))
                && !/^[\s,，:：]*(?:底|上|下)层\s*$/u.test(sentence.slice(consumed, match.index))) return assertions;
            if (UNCERTAIN_CONTEXT.test(before)
                || (!continuesWithDimension && !/^\s*(?:$|[,，。;；!?！？]|\.(?!\d)|且|并且|\band\b)/iu.test(afterDimensions))
                || /^\s*[,，]\s*\d/u.test(afterDimensions)
                || /^\s*(?:[?？]|[,，]\s*(?:(?:这|这一|该)(?:句话|说法|结论))?\s*(?:对吗|对不对|正确吗|是否)|[,，]?\s*\b(?:if|when|correct|true\s+or\s+false|is\s+this\s+true)\b)/iu.test(afterDimensions)) continue;
            const dimension = ROLES[match[1]!.toLowerCase().replace(/\s+/gu, ' ')];
            if (dimension) {
                const layer = stackedLayerAt(sentence.slice(0, match.index));
                assertions.push({ dimension, value: match[2]!.trim(), ...(layer ? { layer } : {}) });
                consumed = match.index + match[0].length;
            }
        }
        if (!/^[\s,，。;；!?！？:：.)\]}）］｝】〕]*$/u.test(sentence.slice(consumed))) return assertions;
    }
    return assertions;
}

function extractRespectiveDimensions(sentence: string): DimensionAssertion[] | null {
    const chinese = RESPECTIVE_LIST_PATTERN.exec(sentence);
    const english = chinese ? null : ENGLISH_RESPECTIVE_LIST_PATTERN.exec(sentence);
    const match = chinese ?? english;
    if (!match || UNCERTAIN_CONTEXT.test(sentence.slice(0, match.index))) return null;
    if (english && !/^[\s.]*$/u.test(sentence.slice(match.index + match[0].length))) return null;
    const prefix = sentence.slice(0, match.index);
    if (!/^[\s,，:：]*(?:(?:其|它的|该图的|其长方体的|其正方体的|长方体的|正方体的|底层|下层|上层|顶层|底部|下部|上部|顶部|its|the|the figure's)\s*)?$/iu.test(prefix)) return null;

    const rolesText = match[1]!;
    const valueText = chinese ? sentence.slice(match.index + match[0].length) : match[2]!;
    const rolePattern = chinese ? ROLE_PATTERN : ENGLISH_ROLE_PATTERN;
    const roles = [...rolesText.matchAll(new RegExp(rolePattern, 'giu'))]
        .map((role) => ROLES[role[0]!.toLowerCase().replace(/\s+/gu, ' ')]);
    if (roles.length < 2 || roles.length > 4 || roles.some((role) => !role) || new Set(roles).size !== roles.length) return null;

    const values = [...valueText.matchAll(DIMENSION_VALUE_PATTERN)];
    if (values.length !== roles.length) return null;
    let consumed = 0;
    const parsedValues: string[] = [];
    for (const value of values) {
        const gap = valueText.slice(consumed, value.index);
        if (consumed > 0 && !/^\s*(?:[,，、](?:\s*and)?|和|与|及|and)\s*$/iu.test(gap)) return null;
        if (consumed === 0 && !/^\s*$/u.test(gap)) return null;
        parsedValues.push(`${value[1]!.trim()}${value[2] ?? ''}`);
        consumed = value.index + value[0].length;
    }
    if (!/^[\s,，、。;；!?！？]*$/u.test(valueText.slice(consumed))) return null;

    // 中文列举常把共同单位只写在末项；仅在前面各项都无单位时共享该显式单位。
    const lastUnit = values.at(-1)?.[2];
    if (lastUnit && values.slice(0, -1).every((value) => !value[2])) {
        for (let index = 0; index < parsedValues.length - 1; index++) parsedValues[index] += lastUnit;
    }
    const layer = stackedLayerAt(prefix);
    return roles.map((dimension, index) => ({ dimension, value: parsedValues[index]!, ...(layer ? { layer } : {}) }));
}

function lengthWidthLabels(
    horizontal: Array<string | undefined>,
    vertical: Array<string | undefined>,
    swapped: boolean,
): DimensionLabels {
    return {
        length: swapped ? vertical : horizontal,
        width: swapped ? horizontal : vertical,
    };
}

function labelAllowsRole(label: string | undefined, role: Dimension): boolean {
    if (!label || (role !== 'length' && role !== 'width')) return true;
    const explicit = label.trim().match(/^(长(?:度)?|宽(?:度)?|\blength\b|\bwidth\b)/iu)?.[1];
    return !explicit || ROLES[explicit.toLowerCase()] === role;
}

function explicitlyDepthLabel(label: string | undefined): boolean {
    const prefix = label?.trim().match(DIMENSION_LABEL_PREFIX)?.[1];
    return Boolean(prefix && ROLES[prefix.toLowerCase()] === 'depth');
}

function matchesDimensions(labels: DimensionLabels, assertions: readonly DimensionAssertion[]): boolean {
    return assertions.every(({ dimension, value }) => {
        const corresponding = labels[dimension];
        if (!corresponding) return true;
        return corresponding.every((label) => labelAllowsRole(label, dimension))
            && validateFigureLengths([
                ...corresponding.map((label) => ({ label: label?.trim().replace(DIMENSION_LABEL_PREFIX, '') })),
                { label: value },
            ], true);
    });
}

/** 只核对主图声明后的明确尺寸标注；允许未指明方向的水平长宽互换，不补值或移动图形。 */
export function validateFigureTemplateDimensions(
    spec: AreaGeometry | SolidGeometry | StackedSolid | RoundSolid | SphereGeometry,
    shape: AreaGeometry['shape'] | SolidGeometry['shape'] | RoundSolid['shape'] | 'rhombus' | 'sphere',
    dimensionText: string,
): boolean {
    if (spec.type === 'stacked_solid') {
        if (shape !== 'cuboid' && shape !== 'cube') return true;
        const assertions = extractDimensions(dimensionText);
        if (!assertions.length) return true;

        return assertions.every(({ dimension, value, layer }) => {
            const parts = layer === 'base' ? [spec.base] : layer === 'top' ? [spec.top] : [spec.base, spec.top];
            const labels = parts.flatMap((part) => dimension === 'height'
                ? [part.heightLabel]
                : [part.widthLabel, part.depthLabel]);
            // 长、宽、底、上下底在轴测图中的水平／深度方向可能互换；只有标注本身
            // 明确写出角色时才限制到同名方向；题干明确层级时只比较对应物体，
            // 避免上下层尺寸互换后仍被另一层的同类标签误通过。
            const candidates = labels.filter((label) => labelAllowsRole(label, dimension));
            return candidates.length === 0
                || candidates.some((label) => validateFigureLengths([{ label }, { label: value }], true));
        });
    }
    if (spec.type === 'round_solid' || spec.type === 'sphere_geometry') {
        if (shape !== 'cylinder' && shape !== 'cone' && shape !== 'sphere') return true;
        const assertions = extractDimensions(dimensionText);
        return validateFigureLengths([
            { label: spec.radiusLabel }, { label: spec.diameterLabel, multiple: 2 },
            ...assertions.filter(({ dimension }) => dimension === 'radius' || dimension === 'diameter')
                .map(({ dimension, value }) => ({ label: value, multiple: dimension === 'diameter' ? 2 as const : 1 as const })),
        ], true) && (spec.type === 'sphere_geometry' || matchesDimensions({ height: [spec.heightLabel], slant: [spec.slantLabel] }, assertions));
    }
    if (shape === 'cylinder' || shape === 'cone' || shape === 'sphere') return true;
    const solidQuestion = shape === 'cube' || shape === 'cuboid';
    if ((spec.type === 'solid_geometry') !== solidQuestion) return true;
    const assertions = extractDimensions(dimensionText);
    if (!assertions.length) return true;
    if (spec.type === 'solid_geometry') {
        const horizontal = [spec.widthLabel];
        const depth = [spec.depthLabel];
        const fixed: DimensionLabels = {
            height: [spec.heightLabel],
            // 容器的深度可能竖直向下；只有图内也明确写“深”才确定对应关系。
            depth: [...horizontal, ...depth, spec.heightLabel].filter(explicitlyDepthLabel),
            ...(shape === 'cube' ? { edge: [...horizontal, ...depth, spec.heightLabel] } : {}),
        };
        return [false, true].some((swapped) => matchesDimensions({
            ...lengthWidthLabels(horizontal, depth, swapped), ...fixed,
        }, assertions));
    }
    const bottom = [spec.baseLabel];
    const top = [spec.topLabel];
    const height = [spec.heightLabel];
    const heightIsSide = spec.shape === 'rectangle' || spec.shape === 'square'
        || (spec.shape === 'parallelogram' && (spec.offset ?? 0) === 0);
    const fixed: DimensionLabels = {
        height, upper: spec.shape === 'triangle' ? undefined : top, lower: bottom,
        ...(spec.shape !== 'trapezoid' ? { base: spec.shape === 'triangle' ? bottom : [...bottom, ...top] } : {}),
        ...(shape === 'square' || shape === 'rhombus' ? { side: [...bottom, ...top, ...(heightIsSide ? height : [])] } : {}),
    };
    if (shape === 'rectangle' || shape === 'square') {
        return [false, true].some((swapped) => matchesDimensions({
            ...lengthWidthLabels([...bottom, ...top], height, swapped), ...fixed,
        }, assertions));
    }
    return matchesDimensions(fixed, assertions);
}

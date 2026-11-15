import { z } from 'zod';
import { sanitizeFigureSvg } from './figure-svg';
import { layoutFigureGroup } from './figure-group-layout';
import { tokenizeFigureText } from './figure-text-tokens';
import { getFigureGeometryViewport, layoutFigureGeometryLabels } from './figure-label-layout';
import { validateCircleLengths, validateFigureLengths, validateRightAngleLabel } from './figure-measurements';
import { validateFigureQuestionConsistency } from './figure-question-consistency';
import type { FigureAngularLabel, FigureCircleLabel, FigureLabelBox, FigureLabelObstacle, FigurePoint, FigureSegmentLabel } from './figure-label-layout';

const figureGraphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/**
 * 图形结构化描述。AI 只负责识别结构和题目中的数字，SVG 由本地模板绘制。
 * 坐标类字段统一使用 0~100 的相对坐标，避免模型直接生成脆弱的 SVG 坐标。
 */
function normalizeOperation(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    return ({
        '＋': '+',
        '－': '-',
        '−': '-',
        '—': '-',
        '*': '×',
        'x': '×',
        'X': '×',
        '/': '÷',
    } as Record<string, string>)[value.trim()] ?? value;
}

const operationSchema = z.preprocess(normalizeOperation, z.enum(['+', '-', '×', '÷']));

const labelSchema = z.object({
    text: z.string().min(1).max(80),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
});

const verticalArithmeticSchema = z.object({
    type: z.literal('vertical_arithmetic'),
    operation: operationSchema.default('×'),
    top: z.string().min(1).max(40),
    bottom: z.string().min(1).max(40),
    partialProducts: z.array(z.object({
        value: z.string().min(1).max(40),
        label: z.string().max(20).optional(),
        shift: z.number().int().min(0).max(8).optional(),
    })).max(8).default([]),
    result: z.string().max(40).optional(),
    note: z.string().max(100).optional(),
});

const fractionSchema = z.object({
    type: z.literal('fraction'),
    numerator: z.string().min(1).max(40),
    denominator: z.string().min(1).max(40),
    whole: z.string().max(20).optional(),
    model: z.enum(['fraction', 'bar', 'circle']).default('fraction'),
    parts: z.number().int().min(1).max(100).optional(),
    filled: z.number().int().min(0).max(100).optional(),
    label: z.string().max(100).optional(),
});

const MAX_FRACTION_WHOLES = 5;

const numberLineSchema = z.object({
    type: z.literal('number_line'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive().max(100).default(1),
    points: z.array(z.object({
        value: z.number().finite(),
        label: z.string().max(40).optional(),
        color: z.enum(['black', 'red', 'blue', 'green']).optional(),
    })).max(30).default([]),
    label: z.string().max(100).optional(),
}).refine((value) => value.max > value.min, 'number_line max must be greater than min');

const coordinatePlaneSchema = z.object({
    type: z.literal('coordinate_plane'),
    xMin: z.number().finite(),
    xMax: z.number().finite(),
    yMin: z.number().finite(),
    yMax: z.number().finite(),
    xStep: z.number().finite().positive().max(100).default(1),
    yStep: z.number().finite().positive().max(100).default(1),
    points: z.array(z.object({
        id: z.string().min(1).max(20),
        x: z.number().finite(),
        y: z.number().finite(),
        label: z.string().max(30).optional(),
        color: z.enum(['black', 'red', 'blue', 'green']).optional(),
    })).max(30).default([]),
    segments: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(40).default([]),
    labels: z.array(z.object({
        text: z.string().min(1).max(60),
        x: z.number().finite(),
        y: z.number().finite(),
    })).max(30).default([]),
    title: z.string().max(100).optional(),
}).refine((value) => value.xMax > value.xMin && value.yMax > value.yMin, 'coordinate_plane ranges must be increasing');

const circleGeometryPointSchema = z.object({
    id: z.string().min(1).max(20),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    label: z.string().max(30).optional(),
});

const circleGeometrySchema = z.object({
    type: z.literal('circle_geometry'),
    center: circleGeometryPointSchema,
    radius: z.number().finite().positive().max(45),
    points: z.array(circleGeometryPointSchema).max(20).default([]),
    radii: z.array(z.object({
        to: z.string().min(1).max(20),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(10).default([]),
    chords: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(10).default([]),
    diameters: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(5).default([]),
    sectors: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        arcType: z.enum(['minor', 'major']).optional(),
        through: z.string().min(1).max(20).optional(),
        fill: z.enum(['gray', 'lightblue']).optional(),
        label: z.string().max(40).optional(),
    })).max(10).default([]),
    arcs: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        arcType: z.enum(['minor', 'major']).optional(),
        through: z.string().min(1).max(20).optional(),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(10).default([]),
    labels: z.array(labelSchema).max(20).default([]),
    title: z.string().max(100).optional(),
}).superRefine((value, context) => {
    const ids = new Set([value.center.id, ...value.points.map((point) => point.id)]);
    if (ids.size !== value.points.length + 1) {
        context.addIssue({ code: 'custom', message: 'Circle geometry point ids must be unique' });
    }
    const references = [
        ...value.radii.map((item) => [item.to] as const),
        ...value.chords.map((item) => [item.from, item.to] as const),
        ...value.diameters.map((item) => [item.from, item.to] as const),
        ...value.sectors.map((item) => item.through ? [item.from, item.to, item.through] as const : [item.from, item.to] as const),
        ...value.arcs.map((item) => item.through ? [item.from, item.to, item.through] as const : [item.from, item.to] as const),
    ];
    for (const reference of references) {
        if (reference.some((id) => !ids.has(id))) {
            context.addIssue({ code: 'custom', message: 'Circle geometry references an unknown point' });
        }
    }
    for (const item of [...value.diameters, ...value.chords]) {
        if (item.from === item.to) {
            context.addIssue({ code: 'custom', message: 'Circle geometry segment endpoints must be distinct' });
        }
    }
    for (const item of [...value.sectors, ...value.arcs]) {
        if (item.from === item.to || item.through === item.from || item.through === item.to) {
            context.addIssue({ code: 'custom', message: 'Circle arc points must be distinct' });
        }
    }
});

const areaGeometrySchema = z.object({
    type: z.literal('area_geometry'),
    shape: z.enum(['triangle', 'rectangle', 'square', 'parallelogram', 'trapezoid']),
    width: z.number().finite().positive().max(100),
    height: z.number().finite().positive().max(100),
    topWidth: z.number().finite().positive().max(100).optional(),
    offset: z.number().finite().min(-50).max(50).optional(),
    apexRatio: z.number().finite().min(0).max(1).optional(),
    baseLabel: z.string().max(40).optional(),
    heightLabel: z.string().max(40).optional(),
    topLabel: z.string().max(40).optional(),
    title: z.string().max(100).optional(),
    fill: z.enum(['none', 'gray', 'lightblue']).default('lightblue'),
}).superRefine((value, context) => {
    if (value.shape === 'square' && Math.abs(value.width - value.height) > Math.max(0.01, value.width * 0.02)) {
        context.addIssue({ code: 'custom', message: 'Square width and height must match' });
    }
    if (value.shape === 'trapezoid' && value.topWidth === undefined) {
        context.addIssue({ code: 'custom', message: 'Trapezoid requires topWidth' });
    }
    if (value.topWidth !== undefined && value.topWidth >= value.width && value.shape === 'trapezoid') {
        context.addIssue({ code: 'custom', message: 'Trapezoid topWidth must be less than width' });
    }
    if (value.shape !== 'trapezoid' && value.topWidth !== undefined) {
        context.addIssue({ code: 'custom', message: 'topWidth only applies to trapezoid' });
    }
    if (value.shape !== 'parallelogram' && value.shape !== 'trapezoid' && value.offset !== undefined) {
        context.addIssue({ code: 'custom', message: 'offset only applies to parallelogram or trapezoid' });
    }
    if (value.shape !== 'triangle' && value.apexRatio !== undefined) {
        context.addIssue({ code: 'custom', message: 'apexRatio only applies to triangle' });
    }
});

const solidGeometrySchema = z.object({
    type: z.literal('solid_geometry'),
    shape: z.enum(['cube', 'cuboid']),
    width: z.number().finite().positive().max(100),
    depth: z.number().finite().positive().max(100),
    height: z.number().finite().positive().max(100),
    widthLabel: z.string().max(40).optional(),
    depthLabel: z.string().max(40).optional(),
    heightLabel: z.string().max(40).optional(),
    title: z.string().max(100).optional(),
    fill: z.enum(['none', 'gray', 'lightblue']).default('lightblue'),
}).superRefine((value, context) => {
    if (value.shape === 'cube') {
        const max = Math.max(value.width, value.depth, value.height);
        const tolerance = Math.max(0.01, max * 0.02);
        if (Math.abs(value.width - value.depth) > tolerance || Math.abs(value.width - value.height) > tolerance) {
            context.addIssue({ code: 'custom', message: 'Cube width, depth and height must match' });
        }
    }
});

const geometryPointSchema = z.object({
    id: z.string().min(1).max(20),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    label: z.string().max(30).optional(),
});

const geometryAngleSchema = z.object({
    vertex: z.string().min(1).max(20),
    from: z.string().min(1).max(20),
    to: z.string().min(1).max(20),
    style: z.enum(['arc', 'right']).default('arc'),
    radius: z.number().finite().positive().max(40).optional(),
    label: z.string().max(40).optional(),
});

const basicGeometrySchema = z.object({
    type: z.literal('basic_geometry'),
    points: z.array(geometryPointSchema).max(40).default([]),
    segments: z.array(z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(40).optional(),
        dashed: z.boolean().optional(),
    })).max(60).default([]),
    polygons: z.array(z.object({
        points: z.array(z.string().min(1).max(20)).min(3).max(20),
        fill: z.enum(['none', 'gray', 'lightblue']).optional(),
    })).max(20).default([]),
    circles: z.array(z.object({
        center: z.string().min(1).max(20),
        radius: z.number().finite().positive().max(50),
        label: z.string().max(40).optional(),
    })).max(10).default([]),
    angles: z.array(geometryAngleSchema).max(30).default([]),
    labels: z.array(labelSchema).max(30).default([]),
}).superRefine((value, context) => {
    const ids = new Set(value.points.map((point) => point.id));
    for (const segment of value.segments) {
        if (!ids.has(segment.from) || !ids.has(segment.to)) {
            context.addIssue({ code: 'custom', message: 'Geometry segment references an unknown point' });
        }
    }
    for (const polygon of value.polygons) {
        if (polygon.points.some((id) => !ids.has(id))) {
            context.addIssue({ code: 'custom', message: 'Geometry polygon references an unknown point' });
        }
    }
    for (const circle of value.circles) {
        if (!ids.has(circle.center)) {
            context.addIssue({ code: 'custom', message: 'Geometry circle references an unknown point' });
        }
    }
    for (const angle of value.angles) {
        if (!ids.has(angle.vertex) || !ids.has(angle.from) || !ids.has(angle.to)) {
            context.addIssue({ code: 'custom', message: 'Geometry angle references an unknown point' });
        }
        if (angle.vertex === angle.from || angle.vertex === angle.to || angle.from === angle.to) {
            context.addIssue({ code: 'custom', message: 'Geometry angle points must be distinct' });
        }
    }
});

const barChartSchema = z.object({
    type: z.literal('bar_chart'),
    categories: z.array(z.string().min(1).max(30)).min(1).max(20),
    values: z.array(z.number().finite().min(0)).min(1).max(20),
    maxValue: z.number().finite().positive().optional(),
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'bar_chart categories and values must match');

const lineChartSchema = z.object({
    type: z.literal('line_chart'),
    categories: z.array(z.string().min(1).max(30)).min(2).max(30),
    values: z.array(z.number().finite()).min(2).max(30),
    maxValue: z.number().finite().positive().optional(),
    minValue: z.number().finite().optional(),
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'line_chart categories and values must match');

const gridShapeSchema = z.object({
    type: z.literal('grid_shape'),
    rows: z.number().int().min(1).max(30),
    cols: z.number().int().min(1).max(30),
    filledCells: z.array(z.object({ row: z.number().int(), col: z.number().int() })).max(900).default([]),
    cellLabels: z.array(z.object({ row: z.number().int(), col: z.number().int(), text: z.string().min(1).max(20) })).max(100).default([]),
    title: z.string().max(100).optional(),
});

const tableSchema = z.object({
    type: z.literal('table'),
    headers: z.array(z.string().max(40)).min(1).max(12),
    rows: z.array(z.array(z.string().max(40))).max(30),
    title: z.string().max(100).optional(),
});

const singleFigureSchemas = [
    verticalArithmeticSchema,
    fractionSchema,
    numberLineSchema,
    coordinatePlaneSchema,
    circleGeometrySchema,
    areaGeometrySchema,
    solidGeometrySchema,
    basicGeometrySchema,
    barChartSchema,
    lineChartSchema,
    gridShapeSchema,
    tableSchema,
] as const;

const SingleFigureSpecSchema = z.discriminatedUnion('type', singleFigureSchemas);
type SingleFigureSpec = z.infer<typeof SingleFigureSpecSchema>;

const figureGroupSchema = z.object({
    type: z.literal('figure_group'),
    title: z.string().max(100).optional(),
    compareSizes: z.boolean().default(false),
    figures: z.array(z.object({
        label: z.string().min(1).max(20),
        figure: SingleFigureSpecSchema,
    })).min(2).max(6),
});

export const FigureSpecSchema = z.discriminatedUnion('type', [...singleFigureSchemas, figureGroupSchema]);

export type FigureSpec = z.infer<typeof FigureSpecSchema>;

/** 基础几何图统一使用等比例坐标，避免圆和直角因画布拉伸而失真。 */
const GEOMETRY_LAYOUT = {
    left: 205,
    top: 55,
    scale: 3.9,
};

export type FigureSpecDiagnosticReason =
    | 'ok'
    | 'empty_input'
    | 'invalid_json'
    | 'schema_validation'
    | 'semantic_validation'
    | 'renderer_unavailable'
    | 'sanitize_failed'
    | 'invalid_svg_number'
    | 'svg_geometry_out_of_bounds';

export interface FigureSpecDiagnostic {
    ok: boolean;
    reason: FigureSpecDiagnosticReason;
    type?: FigureSpec['type'];
}

export interface FigureSpecRenderResult {
    svg: string | null;
    diagnostic: FigureSpecDiagnostic;
}

function normalizeText(value: string): string {
    // 只转换全角 ASCII；NFKC 会把平方、下标和分数字形改成另一种数学表达。
    return value.normalize('NFC')
        .replace(/[\uff01-\uff5e]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
        .trim().replace(/\s+/g, ' ');
}

function parseIntegerToken(value: string): bigint | null {
    if (!/^-?\d+$/.test(value)) return null;
    try {
        return BigInt(value);
    } catch {
        return null;
    }
}

function normalizeVerticalArithmetic(spec: z.infer<typeof verticalArithmeticSchema>): z.infer<typeof verticalArithmeticSchema> {
    const normalized: z.infer<typeof verticalArithmeticSchema> = { ...spec };
    if (spec.operation === '×') {
        // 数位由行号或显式 shift 确定，与能否计算未知数无关。
        normalized.partialProducts = spec.partialProducts.map((partial, index) => ({ ...partial, shift: partial.shift ?? index }));
    }
    const top = parseIntegerToken(spec.top);
    const bottom = parseIntegerToken(spec.bottom);
    if (top === null || bottom === null) return normalized;

    // 只复算已有的纯整数；不能把填空、未知数字或表达式变成答案。
    const hasNumericResult = spec.result !== undefined && parseIntegerToken(spec.result) !== null;
    if (spec.operation === '×') {
        const bottomDigits = spec.bottom.replace(/^-/, '').split('').reverse();
        normalized.partialProducts = normalized.partialProducts.map((partial, index) => {
            const shift = partial.shift ?? index;
            const digit = bottomDigits[shift];
            if (digit === undefined || parseIntegerToken(partial.value) === null) return partial;
            // 部分积只存单个数位的乘积，数位错开交给 shift 绘制。
            const value = (top * BigInt(digit)).toString();
            return { ...partial, value, shift };
        });
        if (hasNumericResult) normalized.result = (top * bottom).toString();
    } else if (spec.operation === '+') {
        if (hasNumericResult) normalized.result = (top + bottom).toString();
    } else if (spec.operation === '-') {
        if (hasNumericResult) normalized.result = (top - bottom).toString();
    }
    return normalized;
}

function normalizeSingleFigureSpec(spec: SingleFigureSpec): SingleFigureSpec {
    switch (spec.type) {
        case 'vertical_arithmetic':
            return normalizeVerticalArithmetic({
                ...spec,
                top: normalizeText(spec.top),
                bottom: normalizeText(spec.bottom),
                partialProducts: spec.partialProducts.map((partial) => ({
                    ...partial,
                    value: normalizeText(partial.value),
                    ...(partial.label ? { label: normalizeText(partial.label) } : {}),
                })),
                ...(spec.result ? { result: normalizeText(spec.result) } : {}),
                ...(spec.note ? { note: normalizeText(spec.note) } : {}),
            });
        case 'fraction':
            return {
                ...spec,
                numerator: normalizeText(spec.numerator),
                denominator: normalizeText(spec.denominator),
                ...(spec.whole ? { whole: normalizeText(spec.whole) } : {}),
                ...(spec.label ? { label: normalizeText(spec.label) } : {}),
            };
        case 'number_line':
            return {
                ...spec,
                points: spec.points.map((point) => ({
                    ...point,
                    ...(point.label ? { label: normalizeText(point.label) } : {}),
                })),
                ...(spec.label ? { label: normalizeText(spec.label) } : {}),
            };
        case 'coordinate_plane':
            return {
                ...spec,
                points: spec.points.map((point) => ({ ...point, id: normalizeText(point.id), ...(point.label ? { label: normalizeText(point.label) } : {}) })),
                segments: spec.segments.map((segment) => ({
                    ...segment,
                    from: normalizeText(segment.from),
                    to: normalizeText(segment.to),
                    ...(segment.label ? { label: normalizeText(segment.label) } : {}),
                })),
                labels: spec.labels.map((label) => ({ ...label, text: normalizeText(label.text) })),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'circle_geometry':
            return {
                ...spec,
                center: {
                    ...spec.center,
                    id: normalizeText(spec.center.id),
                    ...(spec.center.label ? { label: normalizeText(spec.center.label) } : {}),
                },
                points: spec.points.map((point) => ({
                    ...point,
                    id: normalizeText(point.id),
                    ...(point.label ? { label: normalizeText(point.label) } : {}),
                })),
                radii: spec.radii.map((item) => ({ ...item, to: normalizeText(item.to), ...(item.label ? { label: normalizeText(item.label) } : {}) })),
                chords: spec.chords.map((item) => ({
                    ...item,
                    from: normalizeText(item.from),
                    to: normalizeText(item.to),
                    ...(item.label ? { label: normalizeText(item.label) } : {}),
                })),
                diameters: spec.diameters.map((item) => ({
                    ...item,
                    from: normalizeText(item.from),
                    to: normalizeText(item.to),
                    ...(item.label ? { label: normalizeText(item.label) } : {}),
                })),
                sectors: spec.sectors.map((item) => ({
                    ...item,
                    from: normalizeText(item.from),
                    to: normalizeText(item.to),
                    ...(item.through ? { through: normalizeText(item.through) } : {}),
                    ...(item.label ? { label: normalizeText(item.label) } : {}),
                })),
                arcs: spec.arcs.map((item) => ({
                    ...item,
                    from: normalizeText(item.from),
                    to: normalizeText(item.to),
                    ...(item.through ? { through: normalizeText(item.through) } : {}),
                    ...(item.label ? { label: normalizeText(item.label) } : {}),
                })),
                labels: spec.labels.map((label) => ({ ...label, text: normalizeText(label.text) })),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'area_geometry':
            return {
                ...spec,
                ...(spec.baseLabel ? { baseLabel: normalizeText(spec.baseLabel) } : {}),
                ...(spec.heightLabel ? { heightLabel: normalizeText(spec.heightLabel) } : {}),
                ...(spec.topLabel ? { topLabel: normalizeText(spec.topLabel) } : {}),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'solid_geometry':
            return {
                ...spec,
                ...(spec.widthLabel ? { widthLabel: normalizeText(spec.widthLabel) } : {}),
                ...(spec.depthLabel ? { depthLabel: normalizeText(spec.depthLabel) } : {}),
                ...(spec.heightLabel ? { heightLabel: normalizeText(spec.heightLabel) } : {}),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'basic_geometry':
            return {
                ...spec,
                points: spec.points.map((point) => ({ ...point, id: normalizeText(point.id), ...(point.label ? { label: normalizeText(point.label) } : {}) })),
                segments: spec.segments.map((segment) => ({
                    ...segment,
                    from: normalizeText(segment.from),
                    to: normalizeText(segment.to),
                    ...(segment.label ? { label: normalizeText(segment.label) } : {}),
                })),
                polygons: spec.polygons.map((polygon) => ({ ...polygon, points: polygon.points.map(normalizeText) })),
                circles: spec.circles.map((circle) => ({
                    ...circle,
                    center: normalizeText(circle.center),
                    ...(circle.label ? { label: normalizeText(circle.label) } : {}),
                })),
                angles: spec.angles.map((angle) => ({
                    ...angle,
                    vertex: normalizeText(angle.vertex),
                    from: normalizeText(angle.from),
                    to: normalizeText(angle.to),
                    ...(angle.label ? { label: normalizeText(angle.label) } : {}),
                })),
                labels: spec.labels.map((label) => ({ ...label, text: normalizeText(label.text) })),
            };
        case 'bar_chart':
        case 'line_chart':
            return {
                ...spec,
                categories: spec.categories.map(normalizeText),
                ...(spec.unit ? { unit: normalizeText(spec.unit) } : {}),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'grid_shape':
            return {
                ...spec,
                cellLabels: spec.cellLabels.map((label) => ({ ...label, text: normalizeText(label.text) })),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'table':
            return {
                ...spec,
                headers: spec.headers.map(normalizeText),
                rows: spec.rows.map((row) => row.map(normalizeText)),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
    }
}

function normalizeFigureSpec(spec: FigureSpec): FigureSpec {
    if (spec.type !== 'figure_group') return normalizeSingleFigureSpec(spec);
    return {
        ...spec,
        ...(spec.title ? { title: normalizeText(spec.title) } : {}),
        figures: spec.figures.map((entry) => ({ label: normalizeText(entry.label), figure: normalizeSingleFigureSpec(entry.figure) })),
    };
}

function hasUsableAngleGeometry(
    points: Map<string, { x: number; y: number }>,
    angle: { vertex: string; from: string; to: string; style?: 'arc' | 'right' },
): boolean {
    const vertex = points.get(angle.vertex);
    const from = points.get(angle.from);
    const to = points.get(angle.to);
    if (!vertex || !from || !to) return false;

    const fromVector = { x: from.x - vertex.x, y: from.y - vertex.y };
    const toVector = { x: to.x - vertex.x, y: to.y - vertex.y };
    const fromLength = Math.hypot(fromVector.x, fromVector.y);
    const toLength = Math.hypot(toVector.x, toVector.y);
    if (fromLength < 0.0001 || toLength < 0.0001) return false;

    const cosine = (fromVector.x * toVector.x + fromVector.y * toVector.y) / (fromLength * toLength);
    // Two coincident rays have no visible angle marker. Straight angles remain valid.
    if (cosine > 0.9999) return false;
    // A right-angle square changes the meaning of the figure, so only accept a
    // small coordinate error instead of turning a visibly oblique angle into 90°.
    return angle.style !== 'right' || Math.abs(cosine) <= 0.0872;
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(a: { x: number; y: number }, b: { x: number; y: number }, point: { x: number; y: number }): boolean {
    const epsilon = 0.0001;
    return Math.abs(orientation(a, b, point)) <= epsilon
        && point.x >= Math.min(a.x, b.x) - epsilon
        && point.x <= Math.max(a.x, b.x) + epsilon
        && point.y >= Math.min(a.y, b.y) - epsilon
        && point.y <= Math.max(a.y, b.y) + epsilon;
}

function segmentsIntersect(
    firstStart: { x: number; y: number },
    firstEnd: { x: number; y: number },
    secondStart: { x: number; y: number },
    secondEnd: { x: number; y: number },
): boolean {
    const firstOrientation = orientation(firstStart, firstEnd, secondStart);
    const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
    const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
    const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
    const epsilon = 0.0001;
    if (Math.abs(firstOrientation) <= epsilon && pointOnSegment(firstStart, firstEnd, secondStart)) return true;
    if (Math.abs(secondOrientation) <= epsilon && pointOnSegment(firstStart, firstEnd, secondEnd)) return true;
    if (Math.abs(thirdOrientation) <= epsilon && pointOnSegment(secondStart, secondEnd, firstStart)) return true;
    if (Math.abs(fourthOrientation) <= epsilon && pointOnSegment(secondStart, secondEnd, firstEnd)) return true;
    return (firstOrientation > 0) !== (secondOrientation > 0)
        && (thirdOrientation > 0) !== (fourthOrientation > 0);
}

function hasSelfIntersectingPolygon(points: Array<{ x: number; y: number }>): boolean {
    for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
        const firstNextIndex = (firstIndex + 1) % points.length;
        for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
            const secondNextIndex = (secondIndex + 1) % points.length;
            // Adjacent edges meet at their shared vertex by design.
            if (firstIndex === secondIndex || firstNextIndex === secondIndex || firstIndex === secondNextIndex) continue;
            if (segmentsIntersect(points[firstIndex]!, points[firstNextIndex]!, points[secondIndex]!, points[secondNextIndex]!)) return true;
        }
    }
    return false;
}

interface AreaPoint {
    x: number;
    y: number;
}

interface AreaGeometryLayout {
    polygon: AreaPoint[];
    heightFrom: AreaPoint;
    heightTo: AreaPoint;
    baseLabelPoint: AreaPoint;
    topLabelPoint?: AreaPoint;
}

function getAreaGeometryLayout(spec: z.infer<typeof areaGeometrySchema>): AreaGeometryLayout | null {
    const declaredTopWidth = spec.topWidth ?? spec.width * 0.6;
    const horizontalExtent = Math.max(spec.width + Math.abs(spec.offset ?? 0), declaredTopWidth + Math.abs(spec.offset ?? 0));
    const scale = 70 / Math.max(spec.width, spec.height, horizontalExtent);
    const width = spec.width * scale;
    const height = spec.height * scale;
    const topWidth = declaredTopWidth * scale;
    const baseX = 50 - width / 2;
    const baseY = (100 - height) / 2;
    const bottomY = baseY + height;
    const offset = (spec.offset ?? 0) * scale;
    let polygon: AreaPoint[];
    let heightFrom: AreaPoint;
    let heightTo: AreaPoint;
    let topLabelPoint: AreaPoint | undefined;

    switch (spec.shape) {
        case 'triangle': {
            const apexX = baseX + width * (spec.apexRatio ?? 0.5);
            polygon = [
                { x: baseX, y: bottomY },
                { x: baseX + width, y: bottomY },
                { x: apexX, y: baseY },
            ];
            heightFrom = { x: apexX, y: bottomY };
            heightTo = { x: apexX, y: baseY };
            topLabelPoint = { x: apexX, y: baseY };
            break;
        }
        case 'rectangle':
        case 'square':
            polygon = [
                { x: baseX, y: baseY },
                { x: baseX + width, y: baseY },
                { x: baseX + width, y: bottomY },
                { x: baseX, y: bottomY },
            ];
            heightFrom = { x: baseX, y: bottomY };
            heightTo = { x: baseX, y: baseY };
            topLabelPoint = { x: baseX + width / 2, y: baseY };
            break;
        case 'parallelogram': {
            const topLeft = baseX + offset;
            polygon = [
                { x: baseX, y: bottomY },
                { x: baseX + width, y: bottomY },
                { x: topLeft + width, y: baseY },
                { x: topLeft, y: baseY },
            ];
            heightFrom = { x: topLeft, y: bottomY };
            heightTo = { x: topLeft, y: baseY };
            topLabelPoint = { x: topLeft + width / 2, y: baseY };
            break;
        }
        case 'trapezoid': {
            const topLeft = 50 - topWidth / 2 + offset;
            polygon = [
                { x: baseX, y: bottomY },
                { x: baseX + width, y: bottomY },
                { x: topLeft + topWidth, y: baseY },
                { x: topLeft, y: baseY },
            ];
            heightFrom = { x: topLeft, y: bottomY };
            heightTo = { x: topLeft, y: baseY };
            topLabelPoint = { x: topLeft + topWidth / 2, y: baseY };
            break;
        }
    }

    if ((spec.shape === 'parallelogram' || spec.shape === 'trapezoid')
        && (heightFrom.x < baseX || heightFrom.x > baseX + width)) return null;
    const allPoints = [...polygon, heightFrom, heightTo];
    if (allPoints.some((point) => point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100)) return null;
    return {
        polygon,
        heightFrom,
        heightTo,
        baseLabelPoint: { x: baseX + width / 2, y: bottomY },
        ...(topLabelPoint ? { topLabelPoint } : {}),
    };
}

function validDisplayText(value: string, maxLength: number): boolean {
    return value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validArithmeticToken(value: string): boolean {
    return validDisplayText(value, 18) && /^[0-9a-zA-Z?？_＿□﹖+\-−×xX*/÷=.,，。()（）\s]+$/u.test(value);
}

/** 校验与绘制共用圆周投影，避免径向误差掩盖重合点或改变直径判定。 */
function projectCirclePoint(point: FigurePoint, sourceCenter: FigurePoint, targetCenter: FigurePoint, radius: number): FigurePoint {
    const angle = Math.atan2(point.y - sourceCenter.y, point.x - sourceCenter.x);
    return {
        x: targetCenter.x + Math.cos(angle) * radius,
        y: targetCenter.y + Math.sin(angle) * radius,
    };
}

function validateFigureSpec(spec: FigureSpec): boolean {
    switch (spec.type) {
        case 'figure_group': {
            const labels = spec.figures.map((entry) => entry.label.toLowerCase());
            return new Set(labels).size === labels.length
                && (!spec.title || validDisplayText(spec.title, 60))
                && spec.figures.every((entry) => validDisplayText(entry.label, 12)
                    && (!spec.compareSizes || entry.figure.type === 'circle_geometry'
                        || (entry.figure.type === 'basic_geometry' && entry.figure.circles.every((circle) => circle.radius >= 1)))
                    && validateFigureSpec(entry.figure));
        }
        case 'vertical_arithmetic': {
            if (spec.operation === '×') {
                const shifts = spec.partialProducts.map((partial, index) => partial.shift ?? index);
                if (new Set(shifts).size !== shifts.length) return false;
                if (parseIntegerToken(spec.bottom) !== null) {
                    const digitCount = spec.bottom.replace(/^-/, '').length;
                    if (shifts.some((shift) => shift >= digitCount)) return false;
                }
            }
            return validArithmeticToken(spec.top)
                && validArithmeticToken(spec.bottom)
                && (!spec.result || validArithmeticToken(spec.result))
                && spec.partialProducts.every((partial) => validArithmeticToken(partial.value)
                    && (!partial.label || validDisplayText(partial.label, 12)))
                && (!spec.note || validDisplayText(spec.note, 60));
        }
        case 'fraction': {
            if (!validDisplayText(spec.numerator, 18) || !validDisplayText(spec.denominator, 18)) return false;
            if (spec.whole && !validDisplayText(spec.whole, 12)) return false;
            if (spec.label && !validDisplayText(spec.label, 60)) return false;
            const numerator = parseIntegerToken(spec.numerator);
            const denominator = parseIntegerToken(spec.denominator);
            if (denominator !== null && denominator === BigInt(0)) return false;
            if (spec.model === 'bar' || spec.model === 'circle') {
                const maximumParts = spec.model === 'bar' ? 40 : 24;
                if (!spec.parts || spec.parts > maximumParts || spec.filled === undefined) return false;
                if (denominator !== null && denominator !== BigInt(spec.parts)) return false;
                if (numerator !== null && numerator !== BigInt(spec.filled)) return false;
                if (spec.whole) {
                    const whole = parseIntegerToken(spec.whole);
                    if (whole === null || spec.whole.startsWith('-') || whole < BigInt(0) || whole > BigInt(MAX_FRACTION_WHOLES)) return false;
                }
            }
            return spec.filled === undefined || spec.parts === undefined || spec.filled <= spec.parts;
        }
        case 'number_line': {
            const tickCount = Math.floor((spec.max - spec.min) / spec.step) + 1;
            return tickCount <= 25
                && spec.points.every((point) => point.value >= spec.min && point.value <= spec.max && (!point.label || validDisplayText(point.label, 30)))
                && (!spec.label || validDisplayText(spec.label, 60));
        }
        case 'coordinate_plane': {
            const xTicks = Math.floor((spec.xMax - spec.xMin) / spec.xStep) + 1;
            const yTicks = Math.floor((spec.yMax - spec.yMin) / spec.yStep) + 1;
            const ids = new Set(spec.points.map((point) => point.id));
            return xTicks <= 25
                && yTicks <= 25
                && ids.size === spec.points.length
                && spec.points.every((point) => point.x >= spec.xMin && point.x <= spec.xMax && point.y >= spec.yMin && point.y <= spec.yMax && (!point.label || validDisplayText(point.label, 24)))
                && spec.segments.every((segment) => ids.has(segment.from) && ids.has(segment.to) && (!segment.label || validDisplayText(segment.label, 32)))
                && spec.labels.every((label) => label.x >= spec.xMin && label.x <= spec.xMax && label.y >= spec.yMin && label.y <= spec.yMax && validDisplayText(label.text, 50))
                && (!spec.title || validDisplayText(spec.title, 60));
        }
        case 'circle_geometry': {
            const center = spec.center;
            const points = new Map(spec.points.map((point) => [point.id, point]));
            const allPoints = new Map([[center.id, center], ...spec.points.map((point) => [point.id, point] as const)]);
            const tolerance = Math.max(0.5, spec.radius * 0.03);
            const mappedCenter = {
                x: GEOMETRY_LAYOUT.left + center.x * GEOMETRY_LAYOUT.scale,
                y: GEOMETRY_LAYOUT.top + center.y * GEOMETRY_LAYOUT.scale,
            };
            const mappedRadius = spec.radius * GEOMETRY_LAYOUT.scale;
            if (mappedCenter.x - mappedRadius < 8 || mappedCenter.x + mappedRadius > 792
                || mappedCenter.y - mappedRadius < 8 || mappedCenter.y + mappedRadius > 492) return false;
            const onCircle = (id: string): boolean => {
                const point = points.get(id);
                if (!point) return false;
                const distance = Math.hypot(point.x - center.x, point.y - center.y);
                return distance > 0 && Math.abs(distance - spec.radius) <= tolerance;
            };
            const validLabel = (value: string | undefined, maxLength: number): boolean => !value || validDisplayText(value, maxLength);
            if (spec.points.some((point) => !onCircle(point.id))) return false;
            const projected = spec.points.map((point) => ({ ...point, ...projectCirclePoint(point, center, center, spec.radius) }));
            const projectedPoints = new Map(projected.map((point) => [point.id, point]));
            // 只拒绝浮点计算无法区分的点位，不把排版距离或圆弧方向阈值用于线段判定。
            const pointEpsilon = Number.EPSILON * 100 * 16;
            if (projected.some((point, index) => projected.slice(index + 1)
                .some((other) => Math.hypot(point.x - other.x, point.y - other.y) <= pointEpsilon))) return false;
            if (!validLabel(center.label, 20) || spec.points.some((point) => !validLabel(point.label, 20))) return false;
            if (spec.radii.some((item) => !onCircle(item.to) || !validLabel(item.label, 30))) return false;
            if (spec.chords.some((item) => item.from === item.to || !onCircle(item.from) || !onCircle(item.to) || !validLabel(item.label, 30))) return false;
            if (spec.diameters.some((item) => {
                const from = projectedPoints.get(item.from);
                const to = projectedPoints.get(item.to);
                if (!from || !to || item.from === item.to || !onCircle(item.from) || !onCircle(item.to) || !validLabel(item.label, 30)) return true;
                return Math.hypot((from.x + to.x) / 2 - center.x, (from.y + to.y) / 2 - center.y) > tolerance;
            })) return false;
            const validArc = (item: {
                from: string;
                to: string;
                arcType?: 'minor' | 'major';
                through?: string;
                label?: string;
            }): boolean => {
                const from = points.get(item.from);
                const to = points.get(item.to);
                const through = item.through ? points.get(item.through) : undefined;
                if (!from || !to || (item.through && !through) || !validLabel(item.label, 30)) return false;
                return resolveCircleArcDelta(center, from, to, {
                    arcType: item.arcType,
                    ...(through ? { through } : {}),
                }) !== null;
            };
            if (spec.sectors.some((item) => !validArc(item))) return false;
            if (spec.arcs.some((item) => !validArc(item))) return false;
            if (!validateCircleLengths(spec)) return false;
            return spec.labels.every((label) => validDisplayText(label.text, 60))
                && (!spec.title || validDisplayText(spec.title, 60))
                && allPoints.size === spec.points.length + 1;
        }
        case 'area_geometry':
            return Boolean(getAreaGeometryLayout(spec))
                && (!spec.baseLabel || validDisplayText(spec.baseLabel, 30))
                && (!spec.heightLabel || validDisplayText(spec.heightLabel, 30))
                && (!spec.topLabel || validDisplayText(spec.topLabel, 30))
                && validateFigureLengths([
                    { label: spec.baseLabel }, { label: spec.heightLabel },
                    ...(spec.shape === 'triangle' ? [] : [{ label: spec.topLabel }]),
                ], spec.shape === 'square')
                && (!(spec.shape === 'rectangle' || spec.shape === 'parallelogram')
                    || validateFigureLengths([{ label: spec.baseLabel }, { label: spec.topLabel }], true))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'solid_geometry':
            return (!spec.widthLabel || validDisplayText(spec.widthLabel, 30))
                && (!spec.depthLabel || validDisplayText(spec.depthLabel, 30))
                && (!spec.heightLabel || validDisplayText(spec.heightLabel, 30))
                && validateFigureLengths([{ label: spec.widthLabel }, { label: spec.depthLabel }, { label: spec.heightLabel }], spec.shape === 'cube')
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'basic_geometry': {
            const ids = new Set(spec.points.map((point) => point.id));
            if (ids.size !== spec.points.length) return false;
            const coordinates = new Set<string>();
            for (const point of spec.points) {
                const coordinateKey = `${point.x},${point.y}`;
                if (coordinates.has(coordinateKey)) return false;
                coordinates.add(coordinateKey);
            }
            if (spec.points.some((point) => point.label && !validDisplayText(point.label, 20))) return false;
            if (spec.segments.some((segment) => segment.label && !validDisplayText(segment.label, 30))) return false;
            if (spec.angles.some((angle) => angle.label && !validDisplayText(angle.label, 30))) return false;
            if (spec.angles.some((angle) => angle.style === 'right' && !validateRightAngleLabel(angle.label))) return false;
            if (spec.segments.some((segment) => segment.from === segment.to)) return false;
            if (spec.polygons.some((polygon) => {
                if (new Set(polygon.points).size !== polygon.points.length) return true;
                const points = polygon.points.map((id) => spec.points.find((point) => point.id === id));
                if (points.some((point) => !point)) return true;
                if (hasSelfIntersectingPolygon(points as Array<{ x: number; y: number }>)) return true;
                const area = points.reduce((sum, point, index) => {
                    const next = points[(index + 1) % points.length]!;
                    return sum + point!.x * next.y - next.x * point!.y;
                }, 0);
                return Math.abs(area) < 0.01;
            })) return false;
            const points = new Map(spec.points.map((point) => [point.id, point]));
            if (spec.angles.some((angle) => !hasUsableAngleGeometry(points, angle))) return false;
            if (spec.circles.some((circle) => {
                const center = spec.points.find((point) => point.id === circle.center);
                if (!center) return true;
                const radius = circle.radius * GEOMETRY_LAYOUT.scale;
                const x = GEOMETRY_LAYOUT.left + center.x * GEOMETRY_LAYOUT.scale;
                const y = GEOMETRY_LAYOUT.top + center.y * GEOMETRY_LAYOUT.scale;
                return x - radius < 8 || x + radius > 792 || y - radius < 8 || y + radius > 492;
            })) return false;
            return spec.labels.every((label) => validDisplayText(label.text, 60));
        }
        case 'bar_chart':
            return spec.values.every((value) => value >= 0)
                && (spec.maxValue === undefined || spec.maxValue >= Math.max(...spec.values))
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'line_chart':
            return (spec.maxValue === undefined || spec.maxValue >= Math.max(...spec.values))
                && (spec.minValue === undefined || spec.minValue <= Math.min(...spec.values))
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'grid_shape': {
            const cells = new Set<string>();
            for (const cell of spec.filledCells) {
                if (cell.row < 0 || cell.row >= spec.rows || cell.col < 0 || cell.col >= spec.cols) return false;
                const key = `${cell.row},${cell.col}`;
                if (cells.has(key)) return false;
                cells.add(key);
            }
            const labels = new Set<string>();
            for (const label of spec.cellLabels) {
                if (label.row < 0 || label.row >= spec.rows || label.col < 0 || label.col >= spec.cols || !validDisplayText(label.text, 16)) return false;
                const key = `${label.row},${label.col}`;
                if (labels.has(key)) return false;
                labels.add(key);
            }
            return !spec.title || validDisplayText(spec.title, 60);
        }
        case 'table':
            return spec.headers.every((header) => validDisplayText(header, 30))
                && spec.rows.every((row) => row.length <= spec.headers.length && row.every((cell) => validDisplayText(cell, 30) || cell.length === 0))
                && (!spec.title || validDisplayText(spec.title, 60));
    }
}

const COLORS = {
    black: '#111827',
    red: '#c62828',
    blue: '#1565c0',
    green: '#2e7d32',
    gray: '#e5e7eb',
    lightBlue: '#dbeafe',
};

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function finite(value: number, fallback = 0): number {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function displayLength(value: string): number {
    return Array.from(figureGraphemeSegmenter.segment(value)).length;
}

function displayWidth(value: string): number {
    return Array.from(figureGraphemeSegmenter.segment(value), ({ segment }) => segment).reduce((width, grapheme) => {
        // 组合附加符号、变体选择符和连接符已经包含在前一个字形中，不应再次放大文字框。
        if (/^[\p{M}\p{Cf}]+$/u.test(grapheme)) return width;
        const codePoint = grapheme.codePointAt(0) ?? 0;
        if (codePoint > 0x7f && !/^\p{Script=Latin}/u.test(grapheme)) return width + 1;
        // 宽西文字母留出字体差异的余量，避免估算能放下但浏览器渲染越格。
        if (/[MWmw@%&]/.test(grapheme)) return width + 1.1;
        return width + (/[A-Z]/.test(grapheme) ? 0.8 : 0.62);
    }, 0);
}

function fitCircleLabelSize(value: string, preferredSize: number, maxWidth: number | undefined, radius: number): number {
    const initial = fitFontSize(value, preferredSize, maxWidth);
    for (let size = Math.floor(initial); size >= 12; size -= 1) {
        const width = displayWidth(value) * size;
        const height = size * 1.6;
        if (Math.hypot(width / 2 + 3, height / 2 + 3) < radius) return size;
    }
    return initial;
}

function fitFontSize(value: string, base: number, maxWidth?: number): number {
    if (!maxWidth || displayLength(value) < 2) return base;
    return Math.max(8, Math.min(base, maxWidth / displayWidth(value)));
}

type FigureTextOptions = {
    size?: number; maxWidth?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; weight?: string;
    pointLabel?: FigurePoint; segmentLabel?: { from: FigurePoint; to: FigurePoint }; angularLabel?: FigureAngularLabel;
    fixedLabel?: FigurePoint; circleLabel?: FigureCircleLabel; title?: boolean; lineGap?: number;
};

function text(x: number, y: number, value: string, options: FigureTextOptions = {}): string {
    const size = fitFontSize(value, options.size ?? 22, options.maxWidth);
    const anchor = options.anchor ?? 'middle';
    const color = options.color ?? COLORS.black;
    const weight = options.weight ? ` font-weight="${escapeXml(options.weight)}"` : '';
    let marker = options.pointLabel ? ` data-figure-label="point" data-point-x="${finite(options.pointLabel.x)}" data-point-y="${finite(options.pointLabel.y)}"` : '';
    if (options.segmentLabel) {
        const { from, to } = options.segmentLabel;
        marker = ` data-figure-label="segment" data-from-x="${finite(from.x)}" data-from-y="${finite(from.y)}" data-to-x="${finite(to.x)}" data-to-y="${finite(to.y)}"`;
    }
    if (options.angularLabel) {
        const label = options.angularLabel;
        marker = ` data-figure-label="${label.kind}" data-center-x="${finite(label.center.x)}" data-center-y="${finite(label.center.y)}" data-angle-start="${finite(label.start)}" data-angle-delta="${finite(label.delta)}" data-region-inner="${finite(label.innerRadius)}" data-region-outer="${finite(label.outerRadius)}"`;
    }
    if (options.fixedLabel) marker = ` data-figure-label="fixed" data-anchor-x="${finite(options.fixedLabel.x)}" data-anchor-y="${finite(options.fixedLabel.y)}"`;
    if (options.circleLabel) {
        const label = options.circleLabel;
        marker = ` data-figure-label="circle" data-center-x="${finite(label.center.x)}" data-center-y="${finite(label.center.y)}" data-region-radius="${finite(label.radius)}"`;
    }
    if (options.title) marker += ' data-figure-title="true"';
    return `<text x="${finite(x)}" y="${finite(y)}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${weight}${marker}>${escapeXml(value)}</text>`;
}

function textWithLineWrap(
    x: number,
    y: number,
    value: string,
    options: FigureTextOptions = {},
): string {
    const size = options.size ?? 22;
    const maxWidth = options.maxWidth;
    const lines = wrapTextLines(value, size, maxWidth);
    if (lines.length === 1) return text(x, y, value, options);

    const anchor = options.anchor ?? 'middle';
    const color = options.color ?? COLORS.black;
    const weight = options.weight ? ` font-weight="${escapeXml(options.weight)}"` : '';
    const lineGap = options.lineGap ?? textLineGap(size);
    const fixed = options.fixedLabel ? ` data-figure-label="fixed" data-anchor-x="${finite(options.fixedLabel.x)}" data-anchor-y="${finite(options.fixedLabel.y)}"` : '';
    const title = options.title ? ' data-figure-title="true"' : '';
    return `<text x="${finite(x)}" y="${finite(y)}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${weight}${fixed}${title}>${lines.map((lineValue, index) => `<tspan x="${finite(x)}" dy="${index === 0 ? 0 : lineGap}">${escapeXml(lineValue)}</tspan>`).join('')}</text>`;
}

function textLineGap(size: number): number {
    return Math.max(13, size * 1.12);
}

function wrapTextLines(value: string, size: number, maxWidth?: number): string[] {
    if (!maxWidth || displayWidth(value) * size <= maxWidth) return [value];

    const maxLineWidth = Math.max(1, maxWidth / size);
    const tokens = tokenizeFigureText(value);
    const lines: string[] = [];
    let currentLine = '';
    let currentWidth = 0;
    for (const token of tokens) {
        const tokenWidth = displayWidth(token);
        if (currentLine && currentWidth + tokenWidth > maxLineWidth) {
            lines.push(currentLine);
            currentLine = token;
            currentWidth = tokenWidth;
        } else {
            currentLine += token;
            currentWidth += tokenWidth;
        }
    }
    if (currentLine) lines.push(currentLine);

    return lines;
}

function renderGeometryTitle(value: string, body: FigureLabelBox, placement: 'above' | 'band' = 'above'): { svg: string; box: FigureLabelBox } | null {
    const maxWidth = clamp(body.width - 24, 240, 500);
    for (let size = 21; size >= 12; size -= 1) {
        const lines = wrapTextLines(value, size, maxWidth);
        if (!wrappedLinesFit(lines, size, maxWidth)) continue;
        const width = Math.max(...lines.map((line) => displayWidth(line) * size));
        const lineGap = size * 1.35;
        const height = size * 1.6 + (lines.length - 1) * lineGap;
        // 标题放在完整图文边界上方，不移动图元或占用尺寸标注的位置。
        const top = placement === 'band' ? 4 : body.top - 8 - height;
        if (top < 4) continue;
        const x = clamp(body.left + body.width / 2, width / 2 + 4, 796 - width / 2);
        const y = top + size * 1.2;
        return {
            box: { left: x - width / 2, top, width, height },
            svg: textWithLineWrap(x, y, value, { size, maxWidth, lineGap, fixedLabel: { x, y }, title: true }),
        };
    }
    return null;
}

function createGeometryLabelLayout(minimumFontSize = 8) {
    const obstacles: FigureLabelObstacle[] = [];
    const segmentLabels: Array<FigureSegmentLabel & { value: string; options: FigureTextOptions; size: number }> = [];
    const angularLabels: Array<FigureAngularLabel & { value: string; options: FigureTextOptions; size: number }> = [];
    const circleLabels: Array<FigureCircleLabel & { value: string; options: FigureTextOptions; size: number }> = [];
    const fixedLabels: FigureLabelBox[] = [];
    let title: string | undefined;
    let readable = true;
    const measureText = (value: string, options: FigureTextOptions) => {
        const size = fitFontSize(value, options.size ?? 22, options.maxWidth);
        if (size < minimumFontSize) readable = false;
        return size;
    };
    const reserveSegment = (from: FigurePoint, to: FigurePoint) => obstacles.push({ type: 'segment', from, to });
    return {
        segment: reserveSegment,
        title(value: string) {
            title = value;
        },
        line(x1: number, y1: number, x2: number, y2: number, options: Parameters<typeof line>[4] = {}) {
            reserveSegment({ x: x1, y: y1 }, { x: x2, y: y2 });
            return line(x1, y1, x2, y2, options);
        },
        circle(center: FigurePoint, radius: number) {
            obstacles.push({ type: 'circle', center, radius });
        },
        arc(center: FigurePoint, radius: number, start: number, delta: number) {
            const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 36)));
            for (let index = 0; index < count; index += 1) {
                const point = (step: number) => ({ x: center.x + Math.cos(start + delta * step / count) * radius, y: center.y + Math.sin(start + delta * step / count) * radius });
                reserveSegment(point(index), point(index + 1));
            }
        },
        text(x: number, y: number, value: string, options: FigureTextOptions = {}) {
            const size = measureText(value, options);
            const width = displayWidth(value) * size;
            const anchor = options.anchor ?? 'middle';
            const box: FigureLabelBox = { left: x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0), top: y - size * 1.2, width, height: size * 1.6 };
            fixedLabels.push(box);
            return text(x, y, value, { ...options, fixedLabel: { x, y } });
        },
        segmentLabel(from: FigurePoint, to: FigurePoint, value: string, options: FigureTextOptions = {}, preferredNormal?: FigurePoint, maxGap?: number) {
            const size = measureText(value, options);
            segmentLabels.push({ from, to, value, options, size, width: displayWidth(value) * size, height: size * 1.6, preferredNormal, maxGap });
        },
        angularLabel(region: Omit<FigureAngularLabel, 'width' | 'height'>, value: string, options: FigureTextOptions = {}) {
            const size = measureText(value, options);
            angularLabels.push({ ...region, value, options, size, width: displayWidth(value) * size, height: size * 1.6 });
        },
        circleLabel(center: FigurePoint, radius: number, value: string, options: FigureTextOptions = {}) {
            const size = fitCircleLabelSize(value, options.size ?? 22, options.maxWidth, radius);
            if (size < minimumFontSize) readable = false;
            circleLabels.push({ center, radius, value, options, size, width: displayWidth(value) * size, height: size * 1.6 });
        },
        renderLabels(points: Array<FigurePoint & { label?: string; color?: string; preferBelow?: boolean }>, options: { size: number; maxWidth: number; radius: number }): { svg: string; viewport: FigureLabelBox } | null {
            const labelled = points.filter((point) => point.label).map((point) => {
                const size = measureText(point.label!, options);
                return { ...point, size, width: displayWidth(point.label!) * size, height: size * 1.6 };
            });
            if (!readable) return null;
            const shapes = [...obstacles, ...points.map((point): FigureLabelObstacle => ({ type: 'circle', center: point, radius: options.radius, solid: true }))];
            const boxes = layoutFigureGeometryLabels(labelled, segmentLabels, shapes, angularLabels, undefined, { fixed: fixedLabels, circles: circleLabels });
            if (!boxes) return null;
            const textBoxes = [...fixedLabels, ...boxes.points, ...boxes.segments, ...boxes.angular, ...boxes.circles];
            const body = getFigureGeometryViewport(shapes, textBoxes);
            if (!body) return null;
            const heading = title ? renderGeometryTitle(title, body) : null;
            if (title && !heading) return null;
            const viewport = heading ? getFigureGeometryViewport(shapes, [...textBoxes, heading.box]) : body;
            if (!viewport) return null;
            const lengthText = segmentLabels.map((label, index) => {
                const box = boxes.segments[index];
                return text(box.left + box.width / 2, box.top + label.size * 1.2, label.value, { ...label.options, size: label.size, anchor: 'middle', segmentLabel: label });
            }).join('');
            const angularText = angularLabels.map((label, index) => {
                const box = boxes.angular[index];
                return text(box.left + box.width / 2, box.top + label.size * 1.2, label.value, { ...label.options, size: label.size, anchor: 'middle', angularLabel: label });
            }).join('');
            const circleText = circleLabels.map((label, index) => {
                const box = boxes.circles[index];
                return text(box.left + box.width / 2, box.top + label.size * 1.2, label.value, { ...label.options, size: label.size, anchor: 'middle', circleLabel: label });
            }).join('');
            const pointText = labelled.map((point, index) => {
                const box = boxes.points[index];
                const anchor = box.left >= point.x ? 'start' : box.left + box.width <= point.x ? 'end' : 'middle';
                const x = box.left + (anchor === 'start' ? 0 : anchor === 'end' ? box.width : box.width / 2);
                return text(x, box.top + point.size * 1.2, point.label!, { size: point.size, color: point.color, anchor, pointLabel: point });
            }).join('');
            return { svg: (heading?.svg ?? '') + lengthText + angularText + circleText + pointText, viewport };
        },
    };
}

function wrappedLinesFit(lines: string[], size: number, maxWidth: number): boolean {
    return lines.length <= 3 && lines.every((value) => displayWidth(value) * size <= maxWidth);
}

function line(x1: number, y1: number, x2: number, y2: number, options: { color?: string; width?: number; dashed?: boolean } = {}): string {
    const color = options.color ?? COLORS.black;
    const width = options.width ?? 2;
    const dash = options.dashed ? ' stroke-dasharray="7 5"' : '';
    return `<line x1="${finite(x1)}" y1="${finite(y1)}" x2="${finite(x2)}" y2="${finite(y2)}" stroke="${color}" stroke-width="${width}"${dash} />`;
}

function path(d: string, options: { color?: string; width?: number; fill?: string; dashed?: boolean } = {}): string {
    const color = options.color ?? COLORS.black;
    const width = options.width ?? 2;
    const fill = options.fill ?? 'none';
    const dash = options.dashed ? ' stroke-dasharray="7 5"' : '';
    return `<path d="${escapeXml(d)}" stroke="${color}" stroke-width="${width}" fill="${fill}"${dash} />`;
}

interface FigureDrawing {
    content: string;
    viewport: FigureLabelBox;
}

function root(content: string, height = 500, viewport?: FigureLabelBox): FigureDrawing {
    const { left, top, width, height: frameHeight } = viewport ?? { left: 0, top: 0, width: 800, height };
    const position = viewport ? ` x="${left}" y="${top}"` : '';
    return {
        content: `<rect${position} width="${width}" height="${frameHeight}" fill="#fff"/>${content}`,
        viewport: { left, top, width, height: frameHeight },
    };
}

function serializeDrawing(drawing: FigureDrawing, panel?: { x: number; y: number; width: number; height: number }): string {
    const { left, top, width, height } = drawing.viewport;
    const position = panel ? ` x="${finite(panel.x)}" y="${finite(panel.y)}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg"${position} width="${panel ? finite(panel.width) : width}" height="${panel ? finite(panel.height) : height}" viewBox="${left} ${top} ${width} ${height}" font-family="Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif">${drawing.content}</svg>`;
}

function renderGeometryWithHeading(content: string, body: FigureLabelBox, title: string): FigureDrawing | null {
    const heading = renderGeometryTitle(title, body, 'band');
    if (!heading) return null;
    const bodyY = Math.ceil(heading.box.top + heading.box.height + 12);
    const left = Math.max(0, Math.min(body.left, Math.floor(heading.box.left - 12)));
    const right = Math.min(800, Math.max(body.left + body.width, Math.ceil(heading.box.left + heading.box.width + 12)));
    const height = Math.ceil(bodyY + body.height + 12);
    if (height > 800) return null;
    // 内层画布保持原始坐标和尺寸，只在外层标题下方安排占位，不缩放图形。
    const diagram = serializeDrawing(root(content, 500, body), { x: body.left, y: bodyY, width: body.width, height: body.height });
    return root(heading.svg + `<g data-figure-body="true">${diagram}</g>`, height, { left, top: 0, width: right - left, height });
}

function hasInvalidSvgNumber(svg: string): boolean {
    return /(?:NaN|Infinity|undefined)/i.test(svg)
        || /(?:x|y|x1|y1|x2|y2|cx|cy|r|width|height|font-size)="-?(?:\d+(?:\.\d+)?|\.\d+)e[+-]?\d+"/i.test(svg);
}

function hasOutOfBoundsSvgGeometry(svg: string): boolean {
    const numericAttributes = /(?:x|y|x1|y1|x2|y2|cx|cy|r|width|height)="(-?(?:\d+(?:\.\d+)?|\.\d+))"/gi;
    for (const match of svg.matchAll(numericAttributes)) {
        const value = Number(match[1]);
        if (!Number.isFinite(value) || value < -2 || value > 802) return true;
    }
    const pathData = /\sd="([^"`]*)"/gi;
    const pathNumber = /-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi;
    for (const pathMatch of svg.matchAll(pathData)) {
        for (const numberMatch of pathMatch[1].matchAll(pathNumber)) {
            const value = Number(numberMatch[0]);
            if (!Number.isFinite(value) || value < -2 || value > 802) return true;
        }
    }
    return false;
}

function renderCoordinatePlane(spec: z.infer<typeof coordinatePlaneSchema>): FigureDrawing | null {
    const content: string[] = [];
    const labels = createGeometryLabelLayout();
    const xRange = spec.xMax - spec.xMin;
    const yRange = spec.yMax - spec.yMin;
    // 统一横纵单位比例，避免正方形和垂直关系随绘图区宽高失真。
    const unitScale = Math.min(620 / xRange, 390 / yRange);
    const width = xRange * unitScale;
    const height = yRange * unitScale;
    const separateTitle = spec.title && displayWidth(spec.title) * 21 > clamp(width, 240, 500) ? spec.title : undefined;
    const left = 400 - width / 2;
    const right = left + width;
    const top = 250 - height / 2;
    const bottom = top + height;
    const mapX = (value: number) => left + ((value - spec.xMin) / xRange) * (right - left);
    const mapY = (value: number) => bottom - ((value - spec.yMin) / yRange) * (bottom - top);
    const xTicks = Math.floor((spec.xMax - spec.xMin) / spec.xStep) + 1;
    const yTicks = Math.floor((spec.yMax - spec.yMin) / spec.yStep) + 1;
    if ((xTicks > 1 && spec.xStep * unitScale < 22) || (yTicks > 1 && spec.yStep * unitScale < 18)) return null;

    for (let index = 0; index < xTicks; index += 1) {
        const value = spec.xMin + index * spec.xStep;
        if (value > spec.xMax + spec.xStep / 100) break;
        const x = mapX(value);
        content.push(line(x, top, x, bottom, { color: COLORS.gray, width: 1 }));
        content.push(labels.text(x, bottom + 30, Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))), { size: 15, maxWidth: 48 }));
    }
    for (let index = 0; index < yTicks; index += 1) {
        const value = spec.yMin + index * spec.yStep;
        if (value > spec.yMax + spec.yStep / 100) break;
        const y = mapY(value);
        content.push(line(left, y, right, y, { color: COLORS.gray, width: 1 }));
        if (Math.abs(value) > spec.yStep / 100) content.push(labels.text(left - 18, y + 5, Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))), { size: 15, maxWidth: 42, anchor: 'end' }));
    }

    const axisX = spec.xMin <= 0 && spec.xMax >= 0 ? mapX(0) : left;
    const axisY = spec.yMin <= 0 && spec.yMax >= 0 ? mapY(0) : bottom;
    content.push(labels.line(left, axisY, right, axisY, { width: 2.5 }));
    content.push(labels.line(axisX, bottom, axisX, top, { width: 2.5 }));
    for (const offset of [-7, 7]) labels.segment({ x: right, y: axisY }, { x: right - 12, y: axisY + offset });
    for (const offset of [-7, 7]) labels.segment({ x: axisX, y: top }, { x: axisX + offset, y: top + 12 });
    content.push(`<path d="M ${right} ${axisY} L ${right - 12} ${axisY - 7} M ${right} ${axisY} L ${right - 12} ${axisY + 7}" stroke="${COLORS.black}" stroke-width="2" fill="none"/>`);
    content.push(`<path d="M ${axisX} ${top} L ${axisX - 7} ${top + 12} M ${axisX} ${top} L ${axisX + 7} ${top + 12}" stroke="${COLORS.black}" stroke-width="2" fill="none"/>`);

    const points = new Map(spec.points.map((point) => [point.id, point]));
    for (const segment of spec.segments) {
        const from = points.get(segment.from);
        const to = points.get(segment.to);
        if (!from || !to) continue;
        content.push(labels.line(mapX(from.x), mapY(from.y), mapX(to.x), mapY(to.y), { dashed: segment.dashed }));
        if (segment.label) labels.segmentLabel({ x: mapX(from.x), y: mapY(from.y) }, { x: mapX(to.x), y: mapY(to.y) }, segment.label, { size: 17, maxWidth: 130 });
    }
    for (const point of spec.points) {
        const x = mapX(point.x);
        const y = mapY(point.y);
        const color = COLORS[point.color ?? 'red'];
        content.push(`<circle cx="${x}" cy="${y}" r="6" fill="${color}"/>`);
    }
    for (const label of spec.labels) content.push(labels.text(mapX(label.x), mapY(label.y), label.text, { size: 17, maxWidth: 130 }));
    if (spec.title && !separateTitle) content.push(labels.text(400, 32, spec.title, { size: 21, maxWidth: 700 }));
    const renderedLabels = labels.renderLabels(spec.points.map((point) => ({ x: mapX(point.x), y: mapY(point.y), label: point.label, color: COLORS[point.color ?? 'red'] })), { size: 18, maxWidth: 110, radius: 6 });
    if (renderedLabels === null) return null;
    content.push(renderedLabels.svg);
    if (separateTitle) return renderGeometryWithHeading(content.join(''), renderedLabels.viewport, separateTitle);
    return root(content.join(''), 500, renderedLabels.viewport);
}

function normalizeAngleDelta(value: number): number {
    let delta = value;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    return delta;
}

const FULL_TURN = Math.PI * 2;
const ARC_EPSILON = 0.0001;
const ARC_AMBIGUITY_TOLERANCE = Math.PI / 180;

function positiveAngleDelta(value: number): number {
    return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function resolveCircleArcDelta(
    center: { x: number; y: number },
    from: { x: number; y: number },
    to: { x: number; y: number },
    selection: { arcType?: 'minor' | 'major'; through?: { x: number; y: number } },
): number | null {
    const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
    const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
    const positiveEnd = positiveAngleDelta(endAngle - startAngle);
    if (positiveEnd < ARC_AMBIGUITY_TOLERANCE || FULL_TURN - positiveEnd < ARC_AMBIGUITY_TOLERANCE) return null;

    const minorDelta = normalizeAngleDelta(endAngle - startAngle);
    const nearSemicircle = Math.abs(positiveEnd - Math.PI) <= ARC_AMBIGUITY_TOLERANCE;
    if (nearSemicircle && !selection.through) return null;

    let delta = minorDelta;
    if (selection.through) {
        const throughAngle = Math.atan2(selection.through.y - center.y, selection.through.x - center.x);
        const positiveThrough = positiveAngleDelta(throughAngle - startAngle);
        if (Math.abs(normalizeAngleDelta(throughAngle - startAngle)) < ARC_AMBIGUITY_TOLERANCE
            || Math.abs(normalizeAngleDelta(throughAngle - endAngle)) < ARC_AMBIGUITY_TOLERANCE) return null;
        delta = positiveThrough < positiveEnd ? positiveEnd : positiveEnd - FULL_TURN;
    } else if (selection.arcType === 'major') {
        delta = minorDelta > 0 ? minorDelta - FULL_TURN : minorDelta + FULL_TURN;
    }
    if (nearSemicircle && selection.arcType) return null;

    const arcSize = Math.abs(delta);
    if (Math.abs(arcSize - Math.PI) <= ARC_EPSILON) return selection.arcType ? null : delta;

    const isMajor = arcSize > Math.PI + ARC_EPSILON;
    if (selection.arcType === 'major' && !isMajor) return null;
    if (selection.arcType === 'minor' && isMajor) return null;
    return delta;
}

function renderCircleGeometry(spec: z.infer<typeof circleGeometrySchema>): FigureDrawing | null {
    const content: string[] = [];
    const labels = createGeometryLabelLayout();
    const center = {
        x: GEOMETRY_LAYOUT.left + spec.center.x * GEOMETRY_LAYOUT.scale,
        y: GEOMETRY_LAYOUT.top + spec.center.y * GEOMETRY_LAYOUT.scale,
    };
    const radius = spec.radius * GEOMETRY_LAYOUT.scale;
    const separateTitle = spec.title && displayWidth(spec.title) * 21 > clamp(radius * 2, 240, 500) ? spec.title : undefined;
    labels.circle(center, radius);
    // 已通过圆周容差校验的点沿原方向对齐半径，使弧线与底圆使用同一个圆心。
    const points = new Map(spec.points.map((point) => {
        return [point.id, {
            ...point,
            ...projectCirclePoint(point, spec.center, center, radius),
        }] as const;
    }));
    const getPoint = (id: string) => points.get(id);
    const angleOf = (point: { x: number; y: number }) => Math.atan2(point.y - center.y, point.x - center.x);
    const arcSegment = (delta: number): string => {
        const largeArc = Math.abs(delta) > Math.PI + ARC_EPSILON ? 1 : 0;
        const sweep = delta > 0 ? 1 : 0;
        return `A ${finite(radius)} ${finite(radius)} 0 ${largeArc} ${sweep}`;
    };
    const arcPath = (from: { x: number; y: number }, to: { x: number; y: number }, delta: number): string => {
        return `M ${finite(from.x)} ${finite(from.y)} ${arcSegment(delta)} ${finite(to.x)} ${finite(to.y)}`;
    };
    content.push(`<circle cx="${finite(center.x)}" cy="${finite(center.y)}" r="${finite(radius)}" fill="#fff" stroke="none"/>`);
    for (const sector of spec.sectors) {
        const from = getPoint(sector.from);
        const to = getPoint(sector.to);
        if (!from || !to) continue;
        const through = sector.through ? getPoint(sector.through) : undefined;
        const delta = resolveCircleArcDelta(center, from, to, { arcType: sector.arcType, through });
        if (delta === null) return null;
        labels.segment(center, from);
        labels.segment(center, to);
        content.push(path(
            `M ${finite(center.x)} ${finite(center.y)} L ${finite(from.x)} ${finite(from.y)} ${arcSegment(delta)} ${finite(to.x)} ${finite(to.y)} Z`,
            { width: 1.5, fill: sector.fill === 'gray' ? COLORS.gray : COLORS.lightBlue },
        ));
        if (sector.label) {
            labels.angularLabel({ kind: 'sector', center, start: angleOf(from), delta, innerRadius: 0, outerRadius: radius, preferredRadius: radius * 0.58 }, sector.label, { size: 18, maxWidth: 100 });
        }
    }

    content.push(`<circle cx="${finite(center.x)}" cy="${finite(center.y)}" r="${finite(radius)}" fill="none" stroke="${COLORS.black}" stroke-width="2"/>`);

    for (const arc of spec.arcs) {
        const from = getPoint(arc.from);
        const to = getPoint(arc.to);
        if (!from || !to) continue;
        const through = arc.through ? getPoint(arc.through) : undefined;
        const delta = resolveCircleArcDelta(center, from, to, { arcType: arc.arcType, through });
        if (delta === null) return null;
        content.push(path(arcPath(from, to, delta), { width: 2, dashed: arc.dashed }));
        if (arc.label) {
            labels.angularLabel({ kind: 'arc', center, start: angleOf(from), delta, innerRadius: radius + 6, outerRadius: radius + 130, preferredRadius: radius + 64 }, arc.label, { size: 18, maxWidth: 100 });
        }
    }
    for (const diameter of spec.diameters) {
        const from = getPoint(diameter.from);
        const to = getPoint(diameter.to);
        if (!from || !to) continue;
        content.push(labels.line(from.x, from.y, to.x, to.y, { dashed: diameter.dashed }));
        if (diameter.label) {
            labels.segmentLabel(from, to, diameter.label, { size: 18, maxWidth: 120 });
        }
    }
    for (const chord of spec.chords) {
        const from = getPoint(chord.from);
        const to = getPoint(chord.to);
        if (!from || !to) continue;
        content.push(labels.line(from.x, from.y, to.x, to.y, { dashed: chord.dashed }));
        if (chord.label) {
            labels.segmentLabel(from, to, chord.label, { size: 18, maxWidth: 120 }, { x: (from.x + to.x) / 2 - center.x, y: (from.y + to.y) / 2 - center.y });
        }
    }
    for (const radiusItem of spec.radii) {
        const to = getPoint(radiusItem.to);
        if (!to) continue;
        content.push(labels.line(center.x, center.y, to.x, to.y, { dashed: radiusItem.dashed }));
        if (radiusItem.label) {
            labels.segmentLabel(center, to, radiusItem.label, { size: 18, maxWidth: 120 }, { x: 1e-3, y: 1 }, Math.max(14, radius * 0.15));
        }
    }
    content.push(`<circle cx="${finite(center.x)}" cy="${finite(center.y)}" r="3.5" fill="${COLORS.black}"/>`);
    for (const point of spec.points) {
        const mapped = points.get(point.id);
        if (!mapped) continue;
        content.push(`<circle cx="${finite(mapped.x)}" cy="${finite(mapped.y)}" r="3.5" fill="${COLORS.black}"/>`);
    }
    for (const label of spec.labels) {
        const mapped = {
            x: GEOMETRY_LAYOUT.left + label.x * GEOMETRY_LAYOUT.scale,
            y: GEOMETRY_LAYOUT.top + label.y * GEOMETRY_LAYOUT.scale,
        };
        content.push(labels.text(mapped.x, mapped.y, label.text, { size: 19, maxWidth: 150 }));
    }
    if (spec.title && !separateTitle) content.push(labels.text(400, 32, spec.title, { size: 21, maxWidth: 700 }));
    const renderedLabels = labels.renderLabels([
        { ...center, label: spec.center.label, preferBelow: true },
        ...points.values(),
    ], { size: 20, maxWidth: 120, radius: 3.5 });
    if (renderedLabels === null) return null;
    content.push(renderedLabels.svg);
    if (separateTitle) return renderGeometryWithHeading(content.join(''), renderedLabels.viewport, separateTitle);
    return root(content.join(''), 500, renderedLabels.viewport);
}

function renderAreaGeometry(spec: z.infer<typeof areaGeometrySchema>): FigureDrawing | null {
    const layout = getAreaGeometryLayout(spec);
    if (!layout) return null;
    const map = (point: AreaPoint): AreaPoint => ({
        x: GEOMETRY_LAYOUT.left + point.x * GEOMETRY_LAYOUT.scale,
        y: GEOMETRY_LAYOUT.top + point.y * GEOMETRY_LAYOUT.scale,
    });
    const polygon = layout.polygon.map(map);
    const heightFrom = map(layout.heightFrom);
    const heightTo = map(layout.heightTo);
    const topLabelPoint = layout.topLabelPoint ? map(layout.topLabelPoint) : undefined;
    const fill = spec.fill === 'gray' ? COLORS.gray : spec.fill === 'lightblue' ? COLORS.lightBlue : 'none';
    const content: string[] = [];
    const labels = createGeometryLabelLayout(12);

    content.push(`<polygon points="${polygon.map((point) => `${finite(point.x)},${finite(point.y)}`).join(' ')}" fill="${fill}" stroke="${COLORS.black}" stroke-width="2"/>`);
    polygon.forEach((point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        content.push(labels.line(point.x, point.y, next.x, next.y));
    });
    // 顶点落在底边端点时，高本身就是三角形外边；保留外边实线，避免再叠画一条虚线。
    const heightIsBoundary = spec.shape === 'triangle' && (spec.apexRatio === 0 || spec.apexRatio === 1);
    if (!heightIsBoundary) content.push(labels.line(heightFrom.x, heightFrom.y, heightTo.x, heightTo.y, { dashed: true, width: 1.8 }));
    if (Math.abs(heightFrom.y - heightTo.y) >= 18) {
        const baseLeft = polygon[0]!.x;
        const baseRight = polygon[1]!.x;
        const direction = heightFrom.x + 10 <= baseRight ? 1 : -1;
        const markSize = Math.min(10, Math.abs(heightFrom.y - heightTo.y) * 0.22);
        const markX = heightFrom.x + direction * markSize;
        const markY = heightFrom.y - markSize;
        content.push(path(
            `M ${finite(heightFrom.x)} ${finite(markY)} L ${finite(markX)} ${finite(markY)} L ${finite(markX)} ${finite(heightFrom.y)}`,
            { width: 1.6 },
        ));
        labels.segment({ x: heightFrom.x, y: markY }, { x: markX, y: markY });
        labels.segment({ x: markX, y: markY }, { x: markX, y: heightFrom.y });
        if (markX < baseLeft - 0.5 || markX > baseRight + 0.5) return null;
    }
    const rectangular = spec.shape === 'rectangle' || spec.shape === 'square';
    if (spec.baseLabel) labels.segmentLabel(polygon[rectangular ? 3 : 0], polygon[rectangular ? 2 : 1], spec.baseLabel, { size: 18, maxWidth: 140 }, { x: 0, y: 1 });
    if (spec.heightLabel) labels.segmentLabel(heightFrom, heightTo, spec.heightLabel, { size: 18, maxWidth: 120 }, { x: 1, y: 0 });
    if (spec.topLabel && topLabelPoint) {
        if (spec.shape === 'triangle') content.push(labels.text(topLabelPoint.x, topLabelPoint.y - 14, spec.topLabel, { size: 18, maxWidth: 140 }));
        else labels.segmentLabel(polygon[rectangular ? 0 : 3], polygon[rectangular ? 1 : 2], spec.topLabel, { size: 18, maxWidth: 140 }, { x: 0, y: -1 });
    }
    if (spec.title) labels.title(spec.title);
    const renderedLabels = labels.renderLabels([], { size: 18, maxWidth: 140, radius: 0 });
    if (!renderedLabels) return null;
    content.push(renderedLabels.svg);
    return root(content.join(''), 500, renderedLabels.viewport);
}

interface SolidGeometryPoint {
    x: number;
    y: number;
}

function renderSolidGeometry(spec: z.infer<typeof solidGeometrySchema>): FigureDrawing | null {
    const maxDimension = Math.max(spec.width, spec.depth, spec.height);
    const scale = 190 / maxDimension;
    const width = spec.width * scale;
    const depthX = spec.depth * scale * 0.56;
    const depthY = spec.depth * scale * 0.32;
    const height = spec.height * scale;
    const origin: SolidGeometryPoint = {
        x: 400 - (width + depthX) / 2,
        y: 330 + depthY / 2,
    };
    const frontBottomLeft = origin;
    const frontBottomRight = { x: origin.x + width, y: origin.y };
    const frontTopLeft = { x: origin.x, y: origin.y - height };
    const frontTopRight = { x: origin.x + width, y: origin.y - height };
    const backBottomLeft = { x: origin.x + depthX, y: origin.y - depthY };
    const backBottomRight = { x: origin.x + width + depthX, y: origin.y - depthY };
    const backTopLeft = { x: origin.x + depthX, y: origin.y - depthY - height };
    const backTopRight = { x: origin.x + width + depthX, y: origin.y - depthY - height };
    const allPoints = [frontBottomLeft, frontBottomRight, frontTopLeft, frontTopRight, backBottomLeft, backBottomRight, backTopLeft, backTopRight];
    if (allPoints.some((point) => point.x < 30 || point.x > 770 || point.y < 30 || point.y > 470)) return null;

    const pointList = (points: SolidGeometryPoint[]) => points.map((point) => `${finite(point.x)},${finite(point.y)}`).join(' ');
    const content: string[] = [];
    const labels = createGeometryLabelLayout(12);
    const baseFill = spec.fill === 'gray' ? COLORS.gray : spec.fill === 'lightblue' ? COLORS.lightBlue : '#fff';
    const sideFill = spec.fill === 'gray' ? '#d1d5db' : spec.fill === 'lightblue' ? '#bfdbfe' : '#f3f4f6';
    const topFill = spec.fill === 'gray' ? '#f3f4f6' : spec.fill === 'lightblue' ? '#eff6ff' : '#fff';

    // 面填充完成后统一登记可见棱和遮挡棱，所有尺寸标注共用避让与归属校验。
    content.push(`<polygon points="${pointList([frontTopLeft, frontTopRight, frontBottomRight, frontBottomLeft])}" fill="${baseFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
    content.push(`<polygon points="${pointList([frontTopRight, backTopRight, backBottomRight, frontBottomRight])}" fill="${sideFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
    content.push(`<polygon points="${pointList([frontTopLeft, backTopLeft, backTopRight, frontTopRight])}" fill="${topFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
    const visibleEdges = [
        [frontBottomLeft, frontBottomRight], [frontBottomRight, frontTopRight],
        [frontTopRight, frontTopLeft], [frontTopLeft, frontBottomLeft],
        [frontTopLeft, backTopLeft], [backTopLeft, backTopRight],
        [backTopRight, frontTopRight], [backTopRight, backBottomRight],
        [backBottomRight, frontBottomRight],
    ];
    for (const [from, to] of visibleEdges) content.push(labels.line(from.x, from.y, to.x, to.y));
    content.push(labels.line(backBottomLeft.x, backBottomLeft.y, backBottomRight.x, backBottomRight.y, { dashed: true, width: 1.8 }));
    content.push(labels.line(frontBottomLeft.x, frontBottomLeft.y, backBottomLeft.x, backBottomLeft.y, { dashed: true, width: 1.8 }));
    content.push(labels.line(backBottomLeft.x, backBottomLeft.y, backTopLeft.x, backTopLeft.y, { dashed: true, width: 1.8 }));

    if (spec.widthLabel) labels.segmentLabel(frontBottomLeft, frontBottomRight, spec.widthLabel, { size: 18, maxWidth: 150 }, { x: 0, y: 1 });
    if (spec.heightLabel) labels.segmentLabel(frontTopLeft, frontBottomLeft, spec.heightLabel, { size: 18, maxWidth: 110 }, { x: -1, y: 0 });
    if (spec.depthLabel) labels.segmentLabel(frontBottomRight, backBottomRight, spec.depthLabel, { size: 18, maxWidth: 130 }, { x: 1, y: 1 });
    if (spec.title) labels.title(spec.title);
    const renderedLabels = labels.renderLabels([], { size: 18, maxWidth: 150, radius: 0 });
    if (!renderedLabels) return null;
    content.push(renderedLabels.svg);
    return root(content.join(''), 500, renderedLabels.viewport);
}

function renderVerticalArithmetic(spec: z.infer<typeof verticalArithmeticSchema>): FigureDrawing | null {
    const content: string[] = [];
    const size = 28;
    const cell = 30;
    const padding = 12;
    const rowGap = 42;
    const labelSize = 18;
    const isColumnToken = (value: string) => /^[+\-−]?[0-9a-zA-Z?□_]+$/u.test(value);
    const numberWidth = (value: string) => isColumnToken(value) ? displayLength(value) * cell : displayWidth(value) * size + 8;
    const values = [
        { value: spec.top, shift: 0 }, { value: spec.bottom, shift: 0 },
        ...spec.partialProducts.map((partial) => ({ value: partial.value, shift: partial.shift ?? 0 })),
        ...(spec.result ? [{ value: spec.result, shift: 0 }] : []),
    ];
    const numberSpan = Math.max(...values.map(({ value, shift }) => numberWidth(value) + shift * cell));
    const labelWidth = Math.max(0, ...spec.partialProducts.map((partial) => displayWidth(partial.label ?? '') * labelSize));
    const labelColumn = Math.max(32, labelWidth ? labelWidth + 16 : 0);
    const bodyWidth = padding * 2 + labelColumn + numberSpan;
    const width = spec.note ? Math.max(240, bodyWidth) : bodyWidth;
    if (width > 800) return null;
    const numberLeft = padding + labelColumn + (width - bodyWidth) / 2;
    const right = numberLeft + numberSpan;
    const unitX = right - cell / 2;
    const drawNumber = (value: string, y: number, role: string, shift = 0) => {
        // 每个数位使用独立文字锚点，数字、字母和方框的字体宽度不会改变列对齐。
        const columns = isColumnToken(value);
        const positions = columns
            ? Array.from(value, (_, index) => unitX - (displayLength(value) - 1 - index + shift) * cell).join(' ')
            : String(right - shift * cell);
        content.push(`<text x="${positions}" y="${y}" text-anchor="${columns ? 'middle' : 'end'}" font-size="${size}" fill="${COLORS.black}" data-arithmetic-row="${role}" data-arithmetic-shift="${shift}">${escapeXml(value)}</text>`);
    };

    const start = padding + size * 1.2;
    drawNumber(spec.top, start, 'top');
    let lastRow = start + rowGap;
    content.push(text(numberLeft - 20, lastRow, spec.operation, { size }));
    drawNumber(spec.bottom, lastRow, 'bottom');
    content.push(line(numberLeft - 32, lastRow + 16, right, lastRow + 16, { width: 2.5 }));

    for (const [index, partial] of spec.partialProducts.entries()) {
        lastRow += index === 0 ? 46 : rowGap;
        if (partial.label) content.push(text(numberLeft - 14, lastRow, partial.label, { size: labelSize, anchor: 'end', weight: '600' }));
        drawNumber(partial.value, lastRow, 'partial', partial.shift ?? 0);
    }
    if (spec.result) {
        if (spec.partialProducts.length > 0) content.push(line(numberLeft - 32, lastRow + 16, right, lastRow + 16, { width: 2.5 }));
        lastRow += 46;
        drawNumber(spec.result, lastRow, 'result');
    }
    let bottom = Math.max(lastRow + size * 0.4, start + rowGap + 18);
    if (spec.note) {
        let note: { size: number; lines: string[] } | undefined;
        for (let noteSize = 18; noteSize >= 12; noteSize -= 1) {
            const lines = wrapTextLines(spec.note, noteSize, width - padding * 2);
            if (wrappedLinesFit(lines, noteSize, width - padding * 2)) { note = { size: noteSize, lines }; break; }
        }
        if (!note) return null;
        const top = bottom + 16;
        const lineGap = note.size * 1.35;
        content.push(textWithLineWrap(width / 2, top + note.size * 1.2, spec.note, { size: note.size, maxWidth: width - padding * 2, lineGap }));
        bottom = top + note.size * 1.6 + (note.lines.length - 1) * lineGap;
    }
    const height = Math.ceil(bottom + padding);
    if (height > 800) return null;
    return root(content.join(''), height, { left: 0, top: 0, width, height });
}

function fractionBar(x: number, y: number, width: number, height: number, parts: number, filled: number): string[] {
    const content = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff" stroke="none"/>`];
    if (filled > 0) content.push(`<rect x="${x}" y="${y}" width="${width * filled / parts}" height="${height}" fill="${COLORS.lightBlue}"/>`);
    for (let index = 1; index < parts; index += 1) {
        const cellX = x + width * index / parts;
        content.push(line(cellX, y, cellX, y + height, { width: 1.5 }));
    }
    content.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${COLORS.black}" stroke-width="2"/>`);
    return content;
}

function fractionCircle(cx: number, cy: number, radius: number, parts: number, filled: number): string[] {
    const content = [`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#fff" stroke="${COLORS.black}" stroke-width="2"/>`];
    if (filled === parts) {
        // 单段圆弧的起终点重合时不会填满整圆，整份涂色直接绘制实心圆。
        content.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${COLORS.lightBlue}" opacity="0.85"/>`);
    } else if (filled > 0) {
        const endAngle = (Math.PI * 2 * filled / parts) - Math.PI / 2;
        const x2 = cx + radius * Math.cos(endAngle);
        const y2 = cy + radius * Math.sin(endAngle);
        const largeArc = filled / parts > 0.5 ? 1 : 0;
        content.push(`<path d="M ${cx} ${cy} L ${cx} ${cy - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${COLORS.lightBlue}" opacity="0.85"/>`);
    }
    for (let index = 0; parts > 1 && index < parts; index += 1) {
        const angle = (Math.PI * 2 * index / parts) - Math.PI / 2;
        content.push(line(cx, cy, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), { width: 1.2 }));
    }
    content.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${COLORS.black}" stroke-width="2"/>`);
    return content;
}

function renderMixedFraction(spec: z.infer<typeof fractionSchema>): FigureDrawing | null {
    const whole = Number(spec.whole);
    const count = whole + 1;
    const columns = Math.min(3, count);
    const rows = Math.ceil(count / columns);
    const tileWidth = (660 - (columns - 1) * 24) / columns;
    const tileHeight = (300 - (rows - 1) * 28) / rows;
    const fraction = `${spec.numerator}/${spec.denominator}`;
    if (fitFontSize(fraction, 18, tileWidth - 12) < 12) return null;
    const content: string[] = [];
    for (let index = 0; index < count; index += 1) {
        const x = 70 + (index % columns) * (tileWidth + 24);
        const y = 70 + Math.floor(index / columns) * (tileHeight + 28);
        const filled = index < whole ? spec.parts! : spec.filled!;
        if (spec.model === 'bar') {
            const height = Math.min(70, tileHeight * 0.4);
            content.push(...fractionBar(x + 8, y + (tileHeight - 32 - height) / 2, tileWidth - 16, height, spec.parts!, filled));
        } else {
            const radius = Math.min(105, tileWidth / 2 - 8, (tileHeight - 32) / 2);
            content.push(...fractionCircle(x + tileWidth / 2, y + (tileHeight - 32) / 2, radius, spec.parts!, filled));
        }
        content.push(text(x + tileWidth / 2, y + tileHeight - 4, index < whole ? '1' : fraction, { size: 18, maxWidth: tileWidth - 12 }));
    }
    content.push(text(400, 425, `${spec.whole} ${fraction}`, { size: 30, maxWidth: 620 }));
    if (spec.label) content.push(text(400, 470, spec.label, { size: 20, maxWidth: 700 }));
    return root(content.join(''));
}

function renderFraction(spec: z.infer<typeof fractionSchema>): FigureDrawing | null {
    if (spec.whole && spec.model !== 'fraction') return renderMixedFraction(spec);
    const content: string[] = [];
    if (spec.model === 'bar' && spec.parts) {
        const parts = spec.parts;
        const filled = clamp(spec.filled ?? 0, 0, parts);
        content.push(...fractionBar(130, 110, 540, 76, parts, filled));
        content.push(text(400, 255, `${spec.numerator}/${spec.denominator}`, { size: 30, maxWidth: 620 }));
    } else if (spec.model === 'circle' && spec.parts && spec.parts <= 24) {
        const filled = clamp(spec.filled ?? 0, 0, spec.parts);
        content.push(...fractionCircle(400, 210, 120, spec.parts, filled));
        content.push(text(400, 390, `${spec.numerator}/${spec.denominator}`, { size: 30, maxWidth: 620 }));
    } else {
        const center = spec.whole ? 430 : 400;
        if (spec.whole) content.push(text(295, 210, spec.whole, { size: 34, maxWidth: 120, anchor: 'end' }));
        content.push(text(center, 175, spec.numerator, { size: 32, maxWidth: 150 }));
        content.push(line(center - 55, 195, center + 55, 195, { width: 2.5 }));
        content.push(text(center, 240, spec.denominator, { size: 32, maxWidth: 150 }));
    }
    if (spec.label) content.push(text(400, 450, spec.label, { size: 20, maxWidth: 700 }));
    return root(content.join(''));
}

function renderNumberLine(spec: z.infer<typeof numberLineSchema>): FigureDrawing {
    const content: string[] = [];
    const x1 = 90;
    const x2 = 710;
    const y = 250;
    const range = spec.max - spec.min;
    content.push(line(x1, y, x2, y, { width: 2.5 }));
    content.push(`<path d="M ${x2} ${y} L ${x2 - 12} ${y - 7} M ${x2} ${y} L ${x2 - 12} ${y + 7}" stroke="${COLORS.black}" stroke-width="2" fill="none"/>`);
    const count = Math.min(80, Math.floor(range / spec.step) + 1);
    for (let index = 0; index < count; index += 1) {
        const value = spec.min + index * spec.step;
        if (value > spec.max + spec.step / 100) break;
        const x = x1 + (value - spec.min) / range * (x2 - x1);
        content.push(line(x, y - 10, x, y + 10, { width: 1.5 }));
        content.push(text(x, y + 38, Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))), { size: 18, maxWidth: 90 }));
    }
    for (const point of spec.points) {
        if (point.value < spec.min || point.value > spec.max) continue;
        const x = x1 + (point.value - spec.min) / range * (x2 - x1);
        const color = COLORS[point.color ?? 'red'];
        content.push(`<circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`);
        if (point.label) content.push(text(x, y - 22, point.label, { size: 20, maxWidth: 100, color }));
    }
    if (spec.label) content.push(text(400, 100, spec.label, { size: 22, maxWidth: 700 }));
    return root(content.join(''));
}

function renderGeometry(spec: z.infer<typeof basicGeometrySchema>): FigureDrawing | null {
    const content: string[] = [];
    const labels = createGeometryLabelLayout();
    const points = new Map(spec.points.map((point) => [point.id, point]));
    const map = (x: number, y: number) => ({
        x: GEOMETRY_LAYOUT.left + clamp(x, 0, 100) * GEOMETRY_LAYOUT.scale,
        y: GEOMETRY_LAYOUT.top + clamp(y, 0, 100) * GEOMETRY_LAYOUT.scale,
    });
    const getPoint = (id: string) => points.get(id);
    for (const polygon of spec.polygons) {
        const coords = polygon.points.map(getPoint).filter((point): point is NonNullable<ReturnType<typeof getPoint>> => Boolean(point)).map((point) => map(point.x, point.y));
        if (coords.length < 3) continue;
        const fill = polygon.fill === 'gray' ? COLORS.gray : polygon.fill === 'lightblue' ? COLORS.lightBlue : 'none';
        coords.forEach((point, index) => labels.segment(point, coords[(index + 1) % coords.length]));
        content.push(`<polygon points="${coords.map((point) => `${point.x},${point.y}`).join(' ')}" fill="${fill}" stroke="${COLORS.black}" stroke-width="2"/>`);
    }
    for (const segment of spec.segments) {
        const from = getPoint(segment.from);
        const to = getPoint(segment.to);
        if (!from || !to) continue;
        const a = map(from.x, from.y);
        const b = map(to.x, to.y);
        content.push(labels.line(a.x, a.y, b.x, b.y, { dashed: segment.dashed }));
        if (segment.label) labels.segmentLabel(a, b, segment.label, { size: 18, maxWidth: 150 });
    }
    for (const circle of spec.circles) {
        const center = getPoint(circle.center);
        if (!center) continue;
        const mapped = map(center.x, center.y);
        labels.circle(mapped, clamp(circle.radius, 1, 50) * GEOMETRY_LAYOUT.scale);
        content.push(`<circle cx="${mapped.x}" cy="${mapped.y}" r="${clamp(circle.radius, 1, 50) * GEOMETRY_LAYOUT.scale}" fill="none" stroke="${COLORS.black}" stroke-width="2"/>`);
        if (circle.label) labels.circleLabel(mapped, clamp(circle.radius, 1, 50) * GEOMETRY_LAYOUT.scale, circle.label, { size: 18, maxWidth: 120 });
    }
    for (const angle of spec.angles) {
        const vertex = getPoint(angle.vertex);
        const from = getPoint(angle.from);
        const to = getPoint(angle.to);
        if (!vertex || !from || !to) continue;

        const mappedVertex = map(vertex.x, vertex.y);
        const mappedFrom = map(from.x, from.y);
        const mappedTo = map(to.x, to.y);
        const fromVector = { x: mappedFrom.x - mappedVertex.x, y: mappedFrom.y - mappedVertex.y };
        const toVector = { x: mappedTo.x - mappedVertex.x, y: mappedTo.y - mappedVertex.y };
        const fromLength = Math.hypot(fromVector.x, fromVector.y);
        const toLength = Math.hypot(toVector.x, toVector.y);
        if (fromLength < 1 || toLength < 1) return null;

        const fromUnit = { x: fromVector.x / fromLength, y: fromVector.y / fromLength };
        const toUnit = { x: toVector.x / toLength, y: toVector.y / toLength };
        const requestedRadius = (angle.radius ?? 10) * GEOMETRY_LAYOUT.scale;
        const markerRadius = Math.min(requestedRadius, fromLength * 0.42, toLength * 0.42, 58);
        if (markerRadius < 4) return null;

        const fromAngle = Math.atan2(fromUnit.y, fromUnit.x);
        let delta = Math.atan2(toUnit.y, toUnit.x) - fromAngle;
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        if (Math.abs(delta) < 0.03) return null;
        const sweep = delta > 0 ? 1 : 0;

        if (angle.style === 'right') {
            const first = {
                x: mappedVertex.x + fromUnit.x * markerRadius,
                y: mappedVertex.y + fromUnit.y * markerRadius,
            };
            const second = {
                x: first.x + toUnit.x * markerRadius,
                y: first.y + toUnit.y * markerRadius,
            };
            const third = {
                x: mappedVertex.x + toUnit.x * markerRadius,
                y: mappedVertex.y + toUnit.y * markerRadius,
            };
            labels.segment(first, second);
            labels.segment(second, third);
            content.push(path(
                `M ${finite(first.x)} ${finite(first.y)} L ${finite(second.x)} ${finite(second.y)} L ${finite(third.x)} ${finite(third.y)}`,
                { width: 2 },
            ));
        } else {
            labels.arc(mappedVertex, markerRadius, fromAngle, delta);
            const start = {
                x: mappedVertex.x + fromUnit.x * markerRadius,
                y: mappedVertex.y + fromUnit.y * markerRadius,
            };
            const end = {
                x: mappedVertex.x + toUnit.x * markerRadius,
                y: mappedVertex.y + toUnit.y * markerRadius,
            };
            content.push(path(
                `M ${finite(start.x)} ${finite(start.y)} A ${finite(markerRadius)} ${finite(markerRadius)} 0 0 ${sweep} ${finite(end.x)} ${finite(end.y)}`,
                { width: 2 },
            ));
        }
        if (angle.label) labels.angularLabel({
            kind: 'angle', center: mappedVertex, start: fromAngle, delta,
            innerRadius: markerRadius * (angle.style === 'right' ? Math.SQRT2 : 1) + 6,
            outerRadius: Math.min(fromLength, toLength) * 0.9,
            preferredRadius: markerRadius + (angle.style === 'right' ? 28 : 18),
        }, angle.label, { size: 18, maxWidth: 90 });
    }
    for (const point of spec.points) {
        const mapped = map(point.x, point.y);
        content.push(`<circle cx="${mapped.x}" cy="${mapped.y}" r="3.5" fill="${COLORS.black}"/>`);
    }
    for (const label of spec.labels) {
        const mapped = map(label.x, label.y);
        content.push(labels.text(mapped.x, mapped.y, label.text, { size: 19, maxWidth: 150 }));
    }
    const renderedLabels = labels.renderLabels(spec.points.map((point) => ({ ...map(point.x, point.y), label: point.label })), { size: 20, maxWidth: 120, radius: 3.5 });
    if (renderedLabels === null) return null;
    content.push(renderedLabels.svg);
    return root(content.join(''), 500, renderedLabels.viewport);
}

function renderChart(spec: z.infer<typeof barChartSchema> | z.infer<typeof lineChartSchema>): FigureDrawing | null {
    const content: string[] = [];
    const isBar = spec.type === 'bar_chart';
    const values = spec.values;
    const maxValue = Math.max(spec.maxValue ?? Math.max(...values, 1), ...values, 1);
    const minValue = spec.type === 'line_chart' ? Math.min(spec.minValue ?? Math.min(0, ...values), ...values) : 0;
    const x = 100;
    const y = 70;
    const width = 600;
    const height = 330;
    const categoryMaxWidth = isBar ? (width / spec.categories.length) * 0.58 : (width / values.length) * 0.9;
    if (spec.categories.some((category) => !wrappedLinesFit(wrapTextLines(category, 16, categoryMaxWidth), 16, categoryMaxWidth))) return null;
    content.push(line(x, y + height, x + width, y + height, { width: 2 }));
    content.push(line(x, y, x, y + height, { width: 2 }));
    if (spec.title) content.push(text(400, 35, spec.title, { size: 22, maxWidth: 700 }));
    const scale = (value: number) => y + height - (value - minValue) / Math.max(1, maxValue - minValue) * height;
    if (isBar) {
        const slot = width / spec.categories.length;
        values.forEach((value, index) => {
            const barHeight = Math.max(0, y + height - scale(value));
            const barWidth = slot * 0.58;
            const barX = x + index * slot + (slot - barWidth) / 2;
            content.push(`<rect x="${barX}" y="${y + height - barHeight}" width="${barWidth}" height="${barHeight}" fill="${COLORS.lightBlue}" stroke="${COLORS.black}" stroke-width="1.5"/>`);
            content.push(textWithLineWrap(barX + barWidth / 2, y + height + 28, spec.categories[index]!, { size: 16, maxWidth: barWidth }));
            content.push(text(barX + barWidth / 2, y + height - barHeight - 10, String(value), { size: 16, maxWidth: barWidth }));
        });
    } else {
        // 折线首尾留出内边距，避免数据点和纵轴、右侧单位标注重叠。
        const plotInset = Math.min(32, width / (values.length * 2));
        const plotWidth = width - plotInset * 2;
        const points = values.map((value, index) => ({ x: x + plotInset + index * plotWidth / (values.length - 1), y: scale(value) }));
        content.push(`<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${COLORS.blue}" stroke-width="3"/>`);
        points.forEach((point, index) => {
            content.push(`<circle cx="${point.x}" cy="${point.y}" r="5" fill="${COLORS.blue}"/>`);
            content.push(textWithLineWrap(point.x, y + height + 28, spec.categories[index]!, { size: 16, maxWidth: width / values.length * 0.9 }));
            content.push(text(point.x, point.y - 12, String(values[index]), { size: 16, maxWidth: 80, color: COLORS.blue }));
        });
    }
    if (spec.unit) content.push(text(735, 70, spec.unit, { size: 18, maxWidth: 55, anchor: 'start' }));
    return root(content.join(''));
}

function getGridLayout(spec: z.infer<typeof gridShapeSchema>): {
    cell: number;
    fontSize: number;
    lineCounts: number[];
    x: number;
    y: number;
    figureHeight: number;
} | null {
    const minimumCell = Math.ceil(Math.max(20, Math.min(380 / spec.cols, 300 / spec.rows)));
    const maximumCell = Math.floor(Math.min(660 / spec.cols, 640 / spec.rows));
    // 优先扩大正方格，再适度减小字号；行数和文字高度都必须能完整装进所属格子。
    for (const fontSize of [22, 20, 18, 16, 14, 12]) {
        for (let cell = minimumCell; cell <= maximumCell; cell += 1) {
            const maxWidth = cell * 0.8;
            const lineCounts: number[] = [];
            const fits = spec.cellLabels.every((label) => {
                const lines = wrapTextLines(label.text, fontSize, maxWidth);
                lineCounts.push(lines.length);
                const blockHeight = fontSize * 1.2 + (lines.length - 1) * textLineGap(fontSize);
                return blockHeight + 6 <= cell && wrappedLinesFit(lines, fontSize, maxWidth);
            });
            if (!fits) continue;
            const figureHeight = Math.max(500, cell * spec.rows + 160);
            return {
                cell, fontSize, lineCounts,
                x: 400 - cell * spec.cols / 2,
                y: (figureHeight - cell * spec.rows) / 2,
                figureHeight,
            };
        }
    }
    return null;
}

function renderGrid(spec: z.infer<typeof gridShapeSchema>): FigureDrawing | null {
    const layout = getGridLayout(spec);
    if (!layout) return null;
    const { cell, fontSize, lineCounts, x, y, figureHeight } = layout;
    const content: string[] = [];
    const filled = new Set(spec.filledCells.map((cellInfo) => `${cellInfo.row},${cellInfo.col}`));
    for (let row = 0; row < spec.rows; row += 1) {
        for (let col = 0; col < spec.cols; col += 1) {
            const cellX = x + col * cell;
            const cellY = y + row * cell;
            const fill = filled.has(`${row},${col}`) ? COLORS.lightBlue : '#fff';
            content.push(`<rect x="${cellX}" y="${cellY}" width="${cell}" height="${cell}" fill="${fill}" stroke="${COLORS.black}" stroke-width="1"/>`);
        }
    }
    spec.cellLabels.forEach((label, index) => {
        const blockHeight = fontSize * 1.2 + (lineCounts[index]! - 1) * textLineGap(fontSize);
        content.push(textWithLineWrap(
            x + (label.col + 0.5) * cell,
            y + label.row * cell + (cell - blockHeight) / 2 + fontSize,
            label.text,
            { size: fontSize, maxWidth: cell * 0.8 },
        ));
    });
    if (spec.title) content.push(text(400, 45, spec.title, { size: 22, maxWidth: 700 }));
    return root(content.join(''), figureHeight);
}

function renderTable(spec: z.infer<typeof tableSchema>): FigureDrawing | null {
    const content: string[] = [];
    const columns = spec.headers.length;
    const rows = spec.rows.slice(0, 30);
    const x = 70;
    const y = 90;
    const width = 660;
    const colWidth = width / columns;
    const headerSize = Math.max(12, Math.min(18, 560 / (rows.length + 1) * 0.55));
    const bodySize = Math.max(11, Math.min(17, 560 / (rows.length + 1) * 0.52));
    const cellMaxWidth = colWidth * 0.85;
    const headerLines = spec.headers.map((header) => wrapTextLines(header, headerSize, cellMaxWidth));
    const bodyLines = rows.map((row) => row.map((value) => wrapTextLines(value, bodySize, cellMaxWidth)));
    if (headerLines.some((lines) => !wrappedLinesFit(lines, headerSize, cellMaxWidth))
        || bodyLines.flat().some((lines) => !wrappedLinesFit(lines, bodySize, cellMaxWidth))) return null;
    const headerLineCounts = headerLines.map((lines) => lines.length);
    const bodyLineCounts = bodyLines.map((row) => row.map((lines) => lines.length));
    const textBlockHeight = (size: number, count: number) => size * 1.2 + (count - 1) * textLineGap(size);
    const rowHeights = [headerLineCounts, ...bodyLineCounts].map((counts, index) => {
        const size = index === 0 ? headerSize : bodySize;
        return Math.max(20, textBlockHeight(size, Math.max(1, ...counts)) + 6);
    });
    const rowBoundaries = [y];
    for (const rowHeight of rowHeights) rowBoundaries.push(rowBoundaries[rowBoundaries.length - 1]! + rowHeight);
    const bottom = rowBoundaries[rowBoundaries.length - 1]!;
    const tableHeight = bottom - y;
    const figureHeight = Math.ceil(Math.max(500, bottom + 40));
    if (y + tableHeight + 40 > 800) return null;
    if (spec.title) content.push(text(400, 45, spec.title, { size: 22, maxWidth: 700 }));
    for (const [index, rowY] of rowBoundaries.entries()) {
        content.push(line(x, rowY, x + width, rowY, { width: index === 0 || index === rowBoundaries.length - 1 ? 2 : 1 }));
    }
    for (let col = 0; col <= columns; col += 1) content.push(line(x + col * colWidth, y, x + col * colWidth, bottom, { width: col === 0 || col === columns ? 2 : 1 }));
    const centeredTextY = (rowIndex: number, size: number, lineCount: number) => {
        return rowBoundaries[rowIndex]! + (rowHeights[rowIndex]! - textBlockHeight(size, lineCount)) / 2 + size;
    };
    spec.headers.forEach((header, index) => content.push(textWithLineWrap(
        x + (index + 0.5) * colWidth,
        centeredTextY(0, headerSize, headerLineCounts[index]!),
        header,
        { size: headerSize, maxWidth: cellMaxWidth, weight: '600' },
    )));
    rows.forEach((row, rowIndex) => row.slice(0, columns).forEach((value, colIndex) => {
        const lineCount = bodyLineCounts[rowIndex]![colIndex]!;
        content.push(textWithLineWrap(
            x + (colIndex + 0.5) * colWidth,
            centeredTextY(rowIndex + 1, bodySize, lineCount),
            value,
            { size: bodySize, maxWidth: cellMaxWidth },
        ));
    }));
    return root(content.join(''), figureHeight);
}

function renderParsedFigureSpec(spec: SingleFigureSpec): FigureDrawing | null {
    switch (spec.type) {
        case 'vertical_arithmetic': return renderVerticalArithmetic(spec);
        case 'fraction': return renderFraction(spec);
        case 'number_line': return renderNumberLine(spec);
        case 'coordinate_plane': return renderCoordinatePlane(spec);
        case 'circle_geometry': return renderCircleGeometry(spec);
        case 'area_geometry': return renderAreaGeometry(spec);
        case 'solid_geometry': return renderSolidGeometry(spec);
        case 'basic_geometry': return renderGeometry(spec);
        case 'bar_chart':
        case 'line_chart': return renderChart(spec);
        case 'grid_shape': return renderGrid(spec);
        case 'table': return renderTable(spec);
        default: return null;
    }
}

function svgFailure(svg: string): FigureSpecDiagnosticReason | null {
    if (hasInvalidSvgNumber(svg)) return 'invalid_svg_number';
    if (hasOutOfBoundsSvgGeometry(svg)) return 'svg_geometry_out_of_bounds';
    return null;
}

function renderFigureGroup(spec: z.infer<typeof figureGroupSchema>): FigureDrawing | null {
    const titleSize = 22;
    const titleWidth = 752;
    const titleLineGap = titleSize * 1.35;
    const titleLines = spec.title ? wrapTextLines(spec.title, titleSize, titleWidth) : [];
    if (spec.title && !wrappedLinesFit(titleLines, titleSize, titleWidth)) return null;
    const drawings: FigureDrawing[] = [];
    for (const entry of spec.figures) {
        const drawing = renderParsedFigureSpec(entry.figure);
        if (!drawing) return null;
        // 每张子图仍执行原有数值和边界校验，不因图组更高而放宽单图范围。
        const svg = sanitizeFigureSvg(serializeDrawing(drawing));
        if (!svg || svgFailure(svg)) return null;
        drawings.push(drawing);
    }
    const sizes = drawings.map((drawing) => {
        const fonts = [...drawing.content.matchAll(/\sfont-size="([\d.]+)"/g)].map((match) => Number(match[1]));
        return { ...drawing.viewport, ...(fonts.length ? { minimumFontSize: Math.min(...fonts) } : {}) };
    });
    const titleHeight = titleLines.length ? 44 + (titleLines.length - 1) * titleLineGap : 0;
    const layout = layoutFigureGroup(sizes, titleHeight);
    if (!layout) return null;
    const content = spec.title ? [textWithLineWrap(400, 40, spec.title, { size: titleSize, maxWidth: titleWidth, lineGap: titleLineGap })] : [];
    spec.figures.forEach((entry, index) => {
        const panel = layout.panels[index];
        content.push(`<g data-figure-panel="${index}" data-figure-option="${escapeXml(entry.label)}">`
            + text(panel.labelX, panel.labelY, entry.label, { size: 22, weight: '600' })
            + serializeDrawing(drawings[index], panel) + '</g>');
    });
    return root(content.join(''), layout.height);
}

function extractJsonObject(raw: string): unknown {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
    return null;
}

/** 解析并校验 AI 的结构化图形描述，同时返回不含原始内容的诊断原因。 */
export function parseFigureSpecDetailed(raw: unknown, questionText?: string | null): { spec: FigureSpec | null; diagnostic: FigureSpecDiagnostic } {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { spec: null, diagnostic: { ok: false, reason: 'empty_input' } };
    }

    let parsed: unknown;
    try {
        parsed = extractJsonObject(raw);
    } catch {
        return { spec: null, diagnostic: { ok: false, reason: 'invalid_json' } };
    }
    if (parsed === null) return { spec: null, diagnostic: { ok: false, reason: 'invalid_json' } };

    const result = FigureSpecSchema.safeParse(parsed);
    const rawType = typeof parsed === 'object' && parsed !== null && 'type' in parsed && typeof parsed.type === 'string'
        ? parsed.type
        : undefined;
    if (!result.success) {
        return {
            spec: null,
            diagnostic: {
                ok: false,
                reason: 'schema_validation',
                ...(rawType ? { type: rawType as FigureSpec['type'] } : {}),
            },
        };
    }

    const normalized = normalizeFigureSpec(result.data);
    if (!validateFigureSpec(normalized) || !validateFigureQuestionConsistency(normalized, questionText)) {
        return { spec: null, diagnostic: { ok: false, reason: 'semantic_validation', type: normalized.type } };
    }
    return { spec: normalized, diagnostic: { ok: true, reason: 'ok', type: normalized.type } };
}

/** 解析并校验 AI 的结构化图形描述。无效描述返回 null，由旧 SVG 或原图兜底。 */
export function parseFigureSpec(raw: unknown, questionText?: string | null): FigureSpec | null {
    return parseFigureSpecDetailed(raw, questionText).spec;
}

/** 将结构化描述绘制为可安全显示的 SVG，并保留可诊断的失败原因。 */
export function renderFigureSpecDetailed(raw: unknown, questionText?: string | null): FigureSpecRenderResult {
    const parsed = parseFigureSpecDetailed(raw, questionText);
    if (!parsed.spec) return { svg: null, diagnostic: parsed.diagnostic };

    let rendered: FigureDrawing | null;
    try {
        rendered = parsed.spec.type === 'figure_group' ? renderFigureGroup(parsed.spec) : renderParsedFigureSpec(parsed.spec);
    } catch {
        return { svg: null, diagnostic: { ok: false, reason: 'renderer_unavailable', type: parsed.spec.type } };
    }
    if (!rendered) return { svg: null, diagnostic: { ok: false, reason: 'renderer_unavailable', type: parsed.spec.type } };

    const svg = sanitizeFigureSvg(serializeDrawing(rendered));
    if (!svg) return { svg: null, diagnostic: { ok: false, reason: 'sanitize_failed', type: parsed.spec.type } };
    if (hasInvalidSvgNumber(svg)) return { svg: null, diagnostic: { ok: false, reason: 'invalid_svg_number', type: parsed.spec.type } };
    if (parsed.spec.type !== 'figure_group' && hasOutOfBoundsSvgGeometry(svg)) return { svg: null, diagnostic: { ok: false, reason: 'svg_geometry_out_of_bounds', type: parsed.spec.type } };
    return { svg, diagnostic: parsed.diagnostic };
}

/** 将结构化描述绘制为可安全显示的 SVG；任何格式或布局错误都不覆盖已有配图。 */
export function renderFigureSpec(raw: unknown, questionText?: string | null): string | null {
    return renderFigureSpecDetailed(raw, questionText).svg;
}

import { z } from 'zod';
import { sanitizeFigureSvg } from './figure-svg';
import { layoutFigureGroup } from './figure-group-layout';
import { createFigureAxisTicks } from './figure-axis-ticks';
import type { FigureAxisTick } from './figure-axis-ticks';
import { getFigureChartDomain } from './figure-chart-scale';
import { tokenizeFigureText } from './figure-text-tokens';
import { getFigureGeometryViewport, layoutFigureGeometryLabels } from './figure-label-layout';
import { validateCircleLengths, validateFigureLengths, validateRightAngleLabel } from './figure-measurements';
import { validateFigureQuestionConsistency } from './figure-question-consistency';
import { ARC_EPSILON, resolveCircleArcDelta } from './circle-arc';
import { projectRoundSolid, roundSolidSchema, sphereGeometrySchema, validateRoundSolidLengths, validateSphereLengths } from './figure-round-solids';
import type { RoundSolidSpec, SphereGeometrySpec } from './figure-round-solids';
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

const divisionStepSchema = z.object({
    value: z.string().min(1).max(40),
    subtract: z.string().min(1).max(40),
    label: z.string().max(20).optional(),
    shift: z.number().int().min(0).max(8),
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
    divisionSteps: z.array(divisionStepSchema).max(8).default([]),
    result: z.string().max(40).optional(),
    remainder: z.string().max(40).optional(),
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
    apexRatio: z.number().finite().min(-1).max(2).optional(),
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

const stackedSolidPartSchema = z.object({
    width: z.number().finite().positive().max(100),
    depth: z.number().finite().positive().max(100),
    height: z.number().finite().positive().max(100),
    widthLabel: z.string().max(40).optional(),
    depthLabel: z.string().max(40).optional(),
    heightLabel: z.string().max(40).optional(),
});

const stackedSolidSchema = z.object({
    type: z.literal('stacked_solid'),
    base: stackedSolidPartSchema,
    top: stackedSolidPartSchema,
    title: z.string().max(100).optional(),
    fill: z.enum(['none', 'gray', 'lightblue']).default('lightblue'),
}).superRefine((value, context) => {
    // 顶物体只能完整落在底物体的上表面，避免把任意组合体误画成规则叠放体。
    if (value.top.width > value.base.width) {
        context.addIssue({ code: 'custom', message: 'Stacked top width cannot exceed base width' });
    }
    if (value.top.depth > value.base.depth) {
        context.addIssue({ code: 'custom', message: 'Stacked top depth cannot exceed base depth' });
    }
});

const cubeNetCellSchema = z.object({
    row: z.number().int().min(-4).max(4),
    col: z.number().int().min(-4).max(4),
    label: z.string().max(20).optional(),
});

const solidNetSchema = z.object({
    type: z.literal('solid_net'),
    shape: z.literal('cube'),
    cells: z.array(cubeNetCellSchema).length(6),
    title: z.string().max(100).optional(),
}).superRefine((value, context) => {
    const positions = new Set(value.cells.map((cell) => `${cell.row},${cell.col}`));
    if (positions.size !== value.cells.length) {
        context.addIssue({ code: 'custom', message: 'Cube net cells must occupy unique positions' });
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

const chartTickStep = z.number().finite().positive().max(100).optional();

const barChartSchema = z.object({
    type: z.literal('bar_chart'),
    categories: z.array(z.string().min(1).max(30)).min(1).max(20),
    values: z.array(z.number().finite().min(0)).min(1).max(20),
    maxValue: z.number().finite().positive().optional(),
    tickStep: chartTickStep,
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'bar_chart categories and values must match');

const lineChartSchema = z.object({
    type: z.literal('line_chart'),
    categories: z.array(z.string().min(1).max(30)).min(2).max(30),
    values: z.array(z.number().finite()).min(2).max(30),
    maxValue: z.number().finite().optional(),
    minValue: z.number().finite().optional(),
    tickStep: chartTickStep,
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'line_chart categories and values must match')
    .refine((value) => value.maxValue === undefined || value.minValue === undefined || value.maxValue > value.minValue,
        'line_chart maxValue must be greater than minValue');

const pieChartSchema = z.object({
    type: z.literal('pie_chart'),
    categories: z.array(z.string().min(1).max(30)).min(2).max(8),
    values: z.array(z.number().finite().min(0)).min(2).max(8),
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'pie_chart categories and values must match')
    .refine((value) => value.values.some((number) => number > 0), 'pie_chart values must contain a positive value');

const pictogramSchema = z.object({
    type: z.literal('pictogram'),
    categories: z.array(z.string().min(1).max(24)).min(1).max(8),
    values: z.array(z.number().finite().min(0)).min(1).max(8),
    perIcon: z.number().finite().positive().max(1000),
    icon: z.enum(['person', 'book', 'apple', 'star', 'flower', 'car', 'ball', 'tree', 'house', 'circle', 'square']),
    unit: z.string().max(20).optional(),
    title: z.string().max(100).optional(),
}).refine((value) => value.categories.length === value.values.length, 'pictogram categories and values must match')
    .refine((value) => value.values.some((number) => number > 0), 'pictogram values must contain a positive value');

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
    stackedSolidSchema,
    solidNetSchema,
    roundSolidSchema,
    sphereGeometrySchema,
    basicGeometrySchema,
    barChartSchema,
    lineChartSchema,
    pieChartSchema,
    pictogramSchema,
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

function normalizeStackedSolidPart(part: z.infer<typeof stackedSolidPartSchema>): z.infer<typeof stackedSolidPartSchema> {
    return {
        ...part,
        ...(part.widthLabel ? { widthLabel: normalizeText(part.widthLabel) } : {}),
        ...(part.depthLabel ? { depthLabel: normalizeText(part.depthLabel) } : {}),
        ...(part.heightLabel ? { heightLabel: normalizeText(part.heightLabel) } : {}),
    };
}

function stripArithmeticSign(value: string): string {
    return value.replace(/^[+\-−]/u, '');
}

function parseIntegerToken(value: string): bigint | null {
    if (!/^[+\-−]?\d+$/u.test(value)) return null;
    try {
        return BigInt(value.replace(/^−/u, '-'));
    } catch {
        return null;
    }
}

function integerDigits(value: string): string | null {
    return /^[+\-−]?\d+$/u.test(value) ? stripArithmeticSign(value) : null;
}

function parseNonNegativeFractionInteger(value: string): bigint | null {
    if (!/^\+?\d+$/u.test(value)) return null;
    try {
        return BigInt(value.replace(/^\+/, ''));
    } catch {
        return null;
    }
}

interface DivisionStepExpectation {
    value: bigint;
    subtract: bigint;
    required: boolean;
}

type DivisionStep = z.infer<typeof divisionStepSchema>;

function divisionProducts(topText: string, bottomText: string): { quotient: bigint; remainder: bigint; steps: Map<number, DivisionStepExpectation> } | null {
    const top = parseIntegerToken(topText);
    const bottom = parseIntegerToken(bottomText);
    if (top === null || bottom === null || top < BigInt(0) || bottom <= BigInt(0)) return null;
    const digits = integerDigits(topText);
    if (digits === null) return null;
    let remainder = BigInt(0);
    const steps = new Map<number, DivisionStepExpectation>();
    for (const [index, digit] of Array.from(digits).entries()) {
        remainder = remainder * BigInt(10) + BigInt(digit);
        const quotientDigit = remainder / bottom;
        const shift = digits.length - index - 1;
        steps.set(shift, { value: remainder, subtract: quotientDigit * bottom, required: quotientDigit > BigInt(0) });
        remainder %= bottom;
    }
    return { quotient: top / bottom, remainder: top % bottom, steps };
}

function validateUnknownDividendSteps(dividendDigits: string, steps: readonly DivisionStep[], divisor: bigint): boolean {
    if (steps.length === 0) return true;
    const digitAt = (shift: number) => dividendDigits[dividendDigits.length - 1 - shift];
    const stepsByShift = new Map(steps.map((step) => [step.shift, step]));
    const possibleDigits = Array.from({ length: 10 }, (_, digit) => BigInt(digit));
    let remainders = new Set([BigInt(0)]);

    // Unknown question digits are explored only where a step constrains them; omitted rows must be zero for every possible digit.
    for (let shift = dividendDigits.length - 1; shift >= 0; shift -= 1) {
        const sourceDigit = digitAt(shift);
        const digits = sourceDigit && /^\d$/u.test(sourceDigit) ? [BigInt(sourceDigit)] : possibleDigits;
        const step = stepsByShift.get(shift);
        const expectedValue = step ? parseIntegerToken(step.value) : null;
        const expectedSubtract = step ? parseIntegerToken(step.subtract) : null;
        const nextRemainders = new Set<bigint>();

        for (const remainder of remainders) {
            for (const digit of digits) {
                const value = remainder * BigInt(10) + digit;
                const quotient = value / divisor;
                const subtract = quotient * divisor;
                if (!step) {
                    if (quotient !== BigInt(0)) return false;
                    nextRemainders.add(value);
                } else {
                    if ((expectedValue !== null && value !== expectedValue)
                        || (expectedSubtract !== null && subtract !== expectedSubtract)) continue;
                    nextRemainders.add(value - subtract);
                }
                if (nextRemainders.size > 4096) return false;
            }
        }
        if (nextRemainders.size === 0) return false;
        remainders = nextRemainders;
    }
    return true;
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
    const hasNumericRemainder = spec.remainder !== undefined && parseIntegerToken(spec.remainder) !== null;
    if (spec.operation === '×') {
        const bottomDigits = integerDigits(spec.bottom)?.split('').reverse() ?? [];
        const multiplierSign = bottom < BigInt(0) ? BigInt(-1) : BigInt(1);
        normalized.partialProducts = normalized.partialProducts.map((partial, index) => {
            const shift = partial.shift ?? index;
            const digit = bottomDigits[shift];
            if (digit === undefined || parseIntegerToken(partial.value) === null) return partial;
            // 部分积只存单个数位的乘积，数位错开交给 shift 绘制。
            const value = (top * BigInt(digit) * multiplierSign).toString();
            return { ...partial, value, shift };
        });
        if (hasNumericResult) normalized.result = (top * bottom).toString();
    } else if (spec.operation === '+') {
        if (hasNumericResult) normalized.result = (top + bottom).toString();
    } else if (spec.operation === '-') {
        if (hasNumericResult) normalized.result = (top - bottom).toString();
    } else if (spec.operation === '÷') {
        const division = divisionProducts(spec.top, spec.bottom);
        if (division) {
            if (hasNumericResult) normalized.result = division.quotient.toString();
            if (hasNumericRemainder) normalized.remainder = division.remainder.toString();
        }
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
                divisionSteps: spec.divisionSteps.map((step) => ({
                    ...step,
                    value: normalizeText(step.value),
                    subtract: normalizeText(step.subtract),
                    ...(step.label ? { label: normalizeText(step.label) } : {}),
                })),
                ...(spec.result ? { result: normalizeText(spec.result) } : {}),
                ...(spec.remainder ? { remainder: normalizeText(spec.remainder) } : {}),
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
        case 'stacked_solid':
            return {
                ...spec,
                base: normalizeStackedSolidPart(spec.base),
                top: normalizeStackedSolidPart(spec.top),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'solid_net':
            return {
                ...spec,
                cells: spec.cells.map((cell) => ({ ...cell, ...(cell.label ? { label: normalizeText(cell.label) } : {}) })),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'round_solid':
            return {
                ...spec,
                ...(spec.radiusLabel ? { radiusLabel: normalizeText(spec.radiusLabel) } : {}),
                ...(spec.diameterLabel ? { diameterLabel: normalizeText(spec.diameterLabel) } : {}),
                ...(spec.heightLabel ? { heightLabel: normalizeText(spec.heightLabel) } : {}),
                ...(spec.slantLabel ? { slantLabel: normalizeText(spec.slantLabel) } : {}),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'sphere_geometry':
            return {
                ...spec,
                ...(spec.radiusLabel ? { radiusLabel: normalizeText(spec.radiusLabel) } : {}),
                ...(spec.diameterLabel ? { diameterLabel: normalizeText(spec.diameterLabel) } : {}),
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
        case 'pie_chart':
            return {
                ...spec,
                categories: spec.categories.map(normalizeText),
                ...(spec.unit ? { unit: normalizeText(spec.unit) } : {}),
                ...(spec.title ? { title: normalizeText(spec.title) } : {}),
            };
        case 'pictogram':
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

function hasConflictingDuplicateUndirectedSegments(
    segments: readonly { from: string; to: string; label?: string; dashed?: boolean }[],
): boolean {
    const groups = new Map<string, typeof segments[number][]>();
    for (const segment of segments) {
        const key = JSON.stringify([segment.from, segment.to].sort());
        groups.set(key, [...(groups.get(key) ?? []), segment]);
    }
    return [...groups.values()].some((group) => {
        if (group.length < 2) return false;
        if (new Set(group.map(({ dashed }) => Boolean(dashed))).size > 1) return true;
        const labels = group.map(({ label }) => label?.trim());
        if (labels.some((label) => !label) || new Set(labels).size !== labels.length) return true;
        return !validateFigureLengths(labels.map((label) => ({ label })), true);
    });
}

interface AreaPoint {
    x: number;
    y: number;
}

interface AreaGeometryLayout {
    polygon: AreaPoint[];
    heightFrom: AreaPoint;
    heightTo: AreaPoint;
    baseExtension?: { from: AreaPoint; to: AreaPoint };
    baseLabelPoint: AreaPoint;
    topLabelPoint?: AreaPoint;
}

function getAreaGeometryLayout(spec: z.infer<typeof areaGeometrySchema>): AreaGeometryLayout | null {
    const declaredTopWidth = spec.topWidth ?? spec.width * 0.6;
    const horizontalExtent = Math.max(spec.width + Math.abs(spec.offset ?? 0), declaredTopWidth + Math.abs(spec.offset ?? 0));
    const apexRatio = spec.apexRatio ?? 0.5;
    const triangleExtent = spec.shape === 'triangle' ? spec.width * (Math.max(1, apexRatio) - Math.min(0, apexRatio)) : 0;
    const scale = 70 / Math.max(spec.width, spec.height, horizontalExtent, triangleExtent);
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
            const apexX = baseX + width * apexRatio;
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

    // 上底完全位于底边右侧时，从外侧上顶点画高，避免垂线穿过四边形后标注归属不清。
    if ((spec.shape === 'parallelogram' || spec.shape === 'trapezoid') && heightFrom.x > baseX + width) {
        heightFrom.x = polygon[2]!.x;
        heightTo.x = polygon[2]!.x;
    }
    const exteriorHeight = heightFrom.x < baseX || heightFrom.x > baseX + width;
    const baseLabelPoint = { x: baseX + width / 2, y: bottomY };
    // 外部高连同完整图形一起居中，只改变画布中的位置，不改变顶点、高或底边的比例。
    if (exteriorHeight) {
        const left = Math.min(...polygon.map((point) => point.x), heightFrom.x);
        const right = Math.max(...polygon.map((point) => point.x), heightFrom.x);
        const shift = 50 - (left + right) / 2;
        for (const point of [...polygon, heightFrom, heightTo, baseLabelPoint, ...(topLabelPoint ? [topLabelPoint] : [])]) point.x += shift;
    }
    const allPoints = [...polygon, heightFrom, heightTo];
    if (allPoints.some((point) => point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100)) return null;
    return {
        polygon,
        heightFrom,
        heightTo,
        ...(exteriorHeight ? { baseExtension: { from: heightFrom, to: polygon[heightFrom.x < polygon[0]!.x ? 0 : 1]! } } : {}),
        baseLabelPoint,
        ...(topLabelPoint ? { topLabelPoint } : {}),
    };
}

function validDisplayText(value: string, maxLength: number): boolean {
    return value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateChartTickStep(spec: Extract<FigureSpec, { type: 'bar_chart' | 'line_chart' }>): boolean {
    if (spec.tickStep === undefined) return true;
    const domain = getFigureChartDomain(spec);
    const ticks = domain ? createFigureAxisTicks(domain.min, domain.max, spec.tickStep) : null;
    return ticks !== null && ticks.length >= 2;
}

/** 只检查可明确识别的可见拉丁点名；说明、隐藏ID和其它记法不推断为同名点。 */
function hasUniqueVisiblePointNames(points: readonly { label?: string }[]): boolean {
    const names = new Set<string>();
    for (const { label } of points) {
        if (!label || !/^[A-Za-z](?:[0-9]+|[₀-₉]+)?['′″]*$/u.test(label)) continue;
        if (names.has(label)) return false;
        names.add(label);
    }
    return true;
}

type CubeNetVector = { x: number; y: number; z: number };
type CubeNetFrame = { normal: CubeNetVector; right: CubeNetVector; down: CubeNetVector };

function sameCubeNetVector(first: CubeNetVector, second: CubeNetVector): boolean {
    return first.x === second.x && first.y === second.y && first.z === second.z;
}

function crossCubeNetVector(first: CubeNetVector, second: CubeNetVector): CubeNetVector {
    return {
        x: first.y * second.z - first.z * second.y,
        y: first.z * second.x - first.x * second.z,
        z: first.x * second.y - first.y * second.x,
    };
}

/** 绕相邻面的折痕旋转 90 度，使用整数方向向量避免浮点误差。 */
function rotateCubeNetVector(vector: CubeNetVector, axis: CubeNetVector, direction: 1 | -1): CubeNetVector {
    if (sameCubeNetVector(vector, axis) || sameCubeNetVector(vector, { x: -axis.x, y: -axis.y, z: -axis.z })) return vector;
    const result = direction === 1 ? crossCubeNetVector(axis, vector) : crossCubeNetVector(vector, axis);
    return { x: Math.round(result.x), y: Math.round(result.y), z: Math.round(result.z) };
}

function rotateCubeNetFrame(frame: CubeNetFrame, axis: CubeNetVector, direction: 1 | -1): CubeNetFrame {
    return {
        normal: rotateCubeNetVector(frame.normal, axis, direction),
        right: rotateCubeNetVector(frame.right, axis, direction),
        down: rotateCubeNetVector(frame.down, axis, direction),
    };
}

/**
 * 正方体展开图必须能沿方格边折叠成六个不同的面。
 * 通过相邻方格传播三维朝向，既拒绝断开的图，也拒绝会重叠或无法折成立方体的方格布局。
 */
function validateCubeNetCells(cells: readonly z.infer<typeof cubeNetCellSchema>[]): boolean {
    const byPosition = new Map(cells.map((cell) => [`${cell.row},${cell.col}`, cell]));
    const first = cells[0];
    if (!first || byPosition.size !== 6) return false;

    const rootFrame: CubeNetFrame = {
        normal: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        down: { x: 0, y: 1, z: 0 },
    };
    const frames = new Map<string, CubeNetFrame>([[`${first.row},${first.col}`, rootFrame]]);
    const queue = [first];
    const directions = [
        { row: 0, col: 1, axis: 'down' as const, direction: 1 as const },
        { row: 0, col: -1, axis: 'down' as const, direction: -1 as const },
        { row: 1, col: 0, axis: 'right' as const, direction: -1 as const },
        { row: -1, col: 0, axis: 'right' as const, direction: 1 as const },
    ];

    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]!;
        const currentKey = `${current.row},${current.col}`;
        const currentFrame = frames.get(currentKey)!;
        for (const direction of directions) {
            const neighbor = byPosition.get(`${current.row + direction.row},${current.col + direction.col}`);
            if (!neighbor) continue;
            const axis = currentFrame[direction.axis];
            const nextFrame = rotateCubeNetFrame(currentFrame, axis, direction.direction);
            const neighborKey = `${neighbor.row},${neighbor.col}`;
            const existing = frames.get(neighborKey);
            if (existing) {
                if (!sameCubeNetVector(existing.normal, nextFrame.normal)
                    || !sameCubeNetVector(existing.right, nextFrame.right)
                    || !sameCubeNetVector(existing.down, nextFrame.down)) return false;
                continue;
            }
            frames.set(neighborKey, nextFrame);
            queue.push(neighbor);
        }
    }

    if (frames.size !== cells.length) return false;
    const normals = new Set([...frames.values()].map((frame) => `${frame.normal.x},${frame.normal.y},${frame.normal.z}`));
    return normals.size === 6 && [...frames.values()].every(({ normal }) => Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) === 1);
}

function validArithmeticToken(value: string): boolean {
    return validDisplayText(value, 18) && /^[0-9a-zA-Z?？_＿□﹖+\-−×xX*/÷=.,，。()（）\s]+$/u.test(value);
}

const COLUMN_ARITHMETIC_TOKEN = /^[+\-−]?[0-9a-zA-Z?□_]+$/u;
const DECIMAL_GRID_TOKEN = /^[+\-−]?[0-9?□_]+(?:\.[0-9?□_]+)?$/u;
const INTEGER_DECIMAL_TOKEN = /^[+\-−]?\d+$/u;

function getDecimalColumnPositions(value: string): number[] | null {
    if (!DECIMAL_GRID_TOKEN.test(value)) return null;
    const characters = Array.from(value);
    const separator = characters.indexOf('.');
    if (separator < 0) return characters.map((_, index) => index - characters.length);
    return characters.map((_, index) => index - separator);
}

function getMultiplicationColumnOffsets(value: string): number[] | null {
    if (!DECIMAL_GRID_TOKEN.test(value)) return null;
    const characters = Array.from(value);
    const columnCount = characters.filter((character) => character !== '.').length;
    let column = 0;
    return characters.map((character) => {
        // 乘法从末位数字对齐，小数点放在相邻数字之间，不额外占一列。
        if (character === '.') return columnCount - column;
        const offset = columnCount - column - 0.5;
        column += 1;
        return offset;
    });
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
            if (spec.operation !== '÷' && spec.remainder !== undefined) return false;
            if (spec.operation !== '÷' && spec.divisionSteps.length > 0) return false;
            if (spec.operation === '×') {
                const shifts = spec.partialProducts.map((partial, index) => partial.shift ?? index);
                if (new Set(shifts).size !== shifts.length) return false;
                if (parseIntegerToken(spec.bottom) !== null) {
                    const digitCount = integerDigits(spec.bottom)?.length ?? 0;
                    if (shifts.some((shift) => shift >= digitCount)) return false;
                } else if (DECIMAL_GRID_TOKEN.test(spec.bottom)) {
                    const digitCount = displayLength(stripArithmeticSign(spec.bottom).replace('.', ''));
                    if (shifts.some((shift) => shift >= digitCount)) return false;
                }
            }
            if (spec.operation === '÷') {
                if (spec.partialProducts.length > 0) return false;
                const integerDivisionLayout = COLUMN_ARITHMETIC_TOKEN.test(spec.top) && COLUMN_ARITHMETIC_TOKEN.test(spec.bottom);
                if (!integerDivisionLayout) {
                    // 小数或复杂表达式继续使用原普通竖式文字布局，不误套整数长除法规则。
                    if (spec.divisionSteps.length > 0 || spec.remainder !== undefined) return false;
                } else {
                    const shifts = spec.divisionSteps.map((step) => step.shift);
                    if (new Set(shifts).size !== shifts.length
                        || shifts.some((shift, index) => index > 0 && shift >= shifts[index - 1]!)) return false;
                    const dividend = parseIntegerToken(spec.top);
                    const divisor = parseIntegerToken(spec.bottom);
                    if (dividend !== null && dividend < BigInt(0)) return false;
                    if (divisor !== null && divisor <= BigInt(0)) return false;
                    if ((INTEGER_DECIMAL_TOKEN.test(spec.top) && dividend === null)
                        || (INTEGER_DECIMAL_TOKEN.test(spec.bottom) && divisor === null)) return false;
                    const dividendDigits = stripArithmeticSign(spec.top);
                    const dividendDigitCount = dividendDigits.length;
                    for (const step of spec.divisionSteps) {
                        const value = parseIntegerToken(step.value);
                        const subtract = parseIntegerToken(step.subtract);
                        const availableDigits = dividendDigitCount - step.shift;
                        if (availableDigits < 1) return false;
                        if (Array.from(step.value).length > availableDigits || Array.from(step.subtract).length > availableDigits) return false;
                        if (value !== null && value < BigInt(0)) return false;
                        if (subtract !== null && subtract < BigInt(0)) return false;
                    }
                    if (divisor !== null) {
                        if (shifts.some((shift) => (shift ?? 0) >= dividendDigitCount)) return false;
                    }
                    const remainder = spec.remainder === undefined ? null : parseIntegerToken(spec.remainder);
                    if (remainder !== null && remainder < BigInt(0)) return false;
                    if (dividend !== null && divisor !== null && divisor > BigInt(0)) {
                        const division = divisionProducts(spec.top, spec.bottom);
                        if (!division) return false;
                        // 没有步骤时保留“只画题目”的能力；一旦 AI 输出了步骤，就必须覆盖所有非零商位。
                        if (spec.divisionSteps.length > 0) {
                            const required = [...division.steps.entries()].filter(([, step]) => step.required).map(([shift]) => shift);
                            if (required.some((shift) => !shifts.includes(shift))) return false;
                        }
                        for (const step of spec.divisionSteps) {
                            const expected = division.steps.get(step.shift);
                            if (!expected) return false;
                            const value = parseIntegerToken(step.value);
                            const subtract = parseIntegerToken(step.subtract);
                            // 纯数字步骤是识别结果，不能静默替换成程序计算值；冲突时回退旧图或原图。
                            if (value !== null && value !== expected.value) return false;
                            if (subtract !== null && subtract !== expected.subtract) return false;
                        }
                    } else if (divisor !== null && divisor > BigInt(0)) {
                        for (const step of spec.divisionSteps) {
                            const subtract = parseIntegerToken(step.subtract);
                            const value = parseIntegerToken(step.value);
                            if (value !== null && (value < BigInt(0) || value >= divisor * BigInt(10))) return false;
                            if (subtract !== null && (subtract < BigInt(0) || subtract % divisor !== BigInt(0))) return false;
                            if (value !== null && subtract !== null && subtract > value) return false;
                            if (value !== null && subtract !== null
                                && subtract !== (value / divisor) * divisor) return false;
                        }
                        if (!validateUnknownDividendSteps(dividendDigits, spec.divisionSteps, divisor)) return false;
                    }
                    if (dividend !== null && divisor !== null
                        && [spec.result, spec.remainder].some((value) => value !== undefined && /^[+\-−]?\d+\.\d+$/u.test(value))) return false;
                }
            }
            return validArithmeticToken(spec.top)
                && validArithmeticToken(spec.bottom)
                && (!spec.result || validArithmeticToken(spec.result))
                && (!spec.remainder || validArithmeticToken(spec.remainder))
                && spec.partialProducts.every((partial) => validArithmeticToken(partial.value)
                    && (!partial.label || validDisplayText(partial.label, 12)))
                && spec.divisionSteps.every((step) => validArithmeticToken(step.value)
                    && validArithmeticToken(step.subtract)
                    && (!step.label || validDisplayText(step.label, 12)))
                && (!spec.note || validDisplayText(spec.note, 60));
        }
        case 'fraction': {
            if (!validDisplayText(spec.numerator, 18) || !validDisplayText(spec.denominator, 18)) return false;
            if (spec.whole && !validDisplayText(spec.whole, 12)) return false;
            if (spec.label && !validDisplayText(spec.label, 60)) return false;
            if (spec.model === 'bar' || spec.model === 'circle') {
                const maximumParts = spec.model === 'bar' ? 40 : 24;
                if (!spec.parts || spec.parts > maximumParts || spec.filled === undefined) return false;
                const numerator = parseNonNegativeFractionInteger(spec.numerator);
                const denominator = parseNonNegativeFractionInteger(spec.denominator);
                if (numerator === null || denominator === null || denominator === BigInt(0)) return false;
                if (denominator !== BigInt(spec.parts) || numerator !== BigInt(spec.filled)) return false;
                if (spec.whole) {
                    const whole = parseIntegerToken(spec.whole);
                    if (whole === null || spec.whole.startsWith('-') || whole < BigInt(0) || whole > BigInt(MAX_FRACTION_WHOLES)) return false;
                }
            } else if (parseIntegerToken(spec.denominator) === BigInt(0)) {
                return false;
            }
            return spec.filled === undefined || spec.parts === undefined || spec.filled <= spec.parts;
        }
        case 'number_line': {
            return createFigureAxisTicks(spec.min, spec.max, spec.step) !== null
                && hasUniqueVisiblePointNames(spec.points)
                && spec.points.every((point) => point.value >= spec.min && point.value <= spec.max && (!point.label || validDisplayText(point.label, 30)))
                && (!spec.label || validDisplayText(spec.label, 60));
        }
        case 'coordinate_plane': {
            const ids = new Set(spec.points.map((point) => point.id));
            return createFigureAxisTicks(spec.xMin, spec.xMax, spec.xStep) !== null
                && createFigureAxisTicks(spec.yMin, spec.yMax, spec.yStep) !== null
                && ids.size === spec.points.length
                && hasUniqueVisiblePointNames(spec.points)
                && spec.points.every((point) => point.x >= spec.xMin && point.x <= spec.xMax && point.y >= spec.yMin && point.y <= spec.yMax && (!point.label || validDisplayText(point.label, 24)))
                && !hasConflictingDuplicateUndirectedSegments(spec.segments)
                && spec.segments.every((segment) => ids.has(segment.from) && ids.has(segment.to) && (!segment.label || validDisplayText(segment.label, 32)))
                && spec.labels.every((label) => label.x >= spec.xMin && label.x <= spec.xMax && label.y >= spec.yMin && label.y <= spec.yMax && validDisplayText(label.text, 50))
                && (!spec.title || validDisplayText(spec.title, 60));
        }
        case 'circle_geometry': {
            const center = spec.center;
            if (!hasUniqueVisiblePointNames([center, ...spec.points])) return false;
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
        case 'stacked_solid': {
            const validPart = (part: z.infer<typeof stackedSolidPartSchema>) => [part.widthLabel, part.depthLabel, part.heightLabel].every((label) =>
                !label || validDisplayText(label, 30))
                && validateFigureLengths([{ label: part.widthLabel }, { label: part.depthLabel }, { label: part.heightLabel }]);
            return validPart(spec.base) && validPart(spec.top) && (!spec.title || validDisplayText(spec.title, 60));
        }
        case 'solid_net':
            return validateCubeNetCells(spec.cells)
                && spec.cells.every((cell) => !cell.label || validDisplayText(cell.label, 20))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'round_solid':
            return [spec.radiusLabel, spec.diameterLabel, spec.heightLabel, spec.slantLabel].every((label) => !label || validDisplayText(label, 30))
                && validateRoundSolidLengths(spec)
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'sphere_geometry':
            return [spec.radiusLabel, spec.diameterLabel].every((label) => !label || validDisplayText(label, 30))
                && validateSphereLengths(spec)
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'basic_geometry': {
            const ids = new Set(spec.points.map((point) => point.id));
            if (ids.size !== spec.points.length) return false;
            if (!hasUniqueVisiblePointNames(spec.points)) return false;
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
            if (hasConflictingDuplicateUndirectedSegments(spec.segments)) return false;
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
                && validateChartTickStep(spec)
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'line_chart':
            return (spec.maxValue === undefined || spec.maxValue >= Math.max(...spec.values))
                && (spec.minValue === undefined || spec.minValue <= Math.min(...spec.values))
                && getFigureChartDomain(spec) !== null
                && validateChartTickStep(spec)
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'pie_chart':
            return spec.values.some((value) => value > 0)
                && spec.values.every((value) => value >= 0)
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        case 'pictogram': {
            const iconCounts = spec.values.map((value) => value / spec.perIcon);
            return iconCounts.every((count) => Number.isInteger(count) && count >= 0 && count <= 16)
                && spec.categories.every((category) => validDisplayText(category, 24))
                && (!spec.unit || validDisplayText(spec.unit, 16))
                && (!spec.title || validDisplayText(spec.title, 60));
        }
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
    arithmeticRow?: string; arithmeticShift?: number;
};

function text(x: number, y: number, value: string, options: FigureTextOptions = {}): string {
    const size = fitFontSize(value, options.size ?? 22, options.maxWidth);
    const anchor = options.anchor ?? 'middle';
    const color = options.color ?? COLORS.black;
    const weight = options.weight ? ` font-weight="${escapeXml(options.weight)}"` : '';
    const labelKind = options.fixedLabel ? 'fixed'
        : options.segmentLabel ? 'segment'
        : options.angularLabel?.kind
        ?? (options.circleLabel ? 'circle' : options.pointLabel ? 'point' : undefined);
    let marker = labelKind ? ` data-figure-label="${labelKind}"` : '';
    if (options.pointLabel) marker += ` data-point-x="${finite(options.pointLabel.x)}" data-point-y="${finite(options.pointLabel.y)}"`;
    if (options.segmentLabel) {
        const { from, to } = options.segmentLabel;
        marker += ` data-from-x="${finite(from.x)}" data-from-y="${finite(from.y)}" data-to-x="${finite(to.x)}" data-to-y="${finite(to.y)}"`;
    }
    if (options.angularLabel) {
        const label = options.angularLabel;
        marker += ` data-center-x="${finite(label.center.x)}" data-center-y="${finite(label.center.y)}" data-angle-start="${finite(label.start)}" data-angle-delta="${finite(label.delta)}" data-region-inner="${finite(label.innerRadius)}" data-region-outer="${finite(label.outerRadius)}"`;
    }
    if (options.fixedLabel) marker += ` data-anchor-x="${finite(options.fixedLabel.x)}" data-anchor-y="${finite(options.fixedLabel.y)}"`;
    if (options.circleLabel) {
        const label = options.circleLabel;
        marker += ` data-center-x="${finite(label.center.x)}" data-center-y="${finite(label.center.y)}" data-region-radius="${finite(label.radius)}"`;
    }
    if (options.title) marker += ' data-figure-title="true"';
    if (options.arithmeticRow) marker += ` data-arithmetic-row="${escapeXml(options.arithmeticRow)}"`;
    if (options.arithmeticShift !== undefined) marker += ` data-arithmetic-shift="${finite(options.arithmeticShift)}"`;
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

function createGeometryLabelLayout(minimumFontSize = 12) {
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

/** 最终输出层再检查一次，防止新增模板漏掉局部字号保护。 */
function hasUnreadableSvgText(svg: string): boolean {
    for (const match of svg.matchAll(/\sfont-size="([\d.]+)"/g)) {
        const size = Number(match[1]);
        if (!Number.isFinite(size) || size < 12) return true;
    }
    return false;
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
    const xTicks = createFigureAxisTicks(spec.xMin, spec.xMax, spec.xStep);
    const yTicks = createFigureAxisTicks(spec.yMin, spec.yMax, spec.yStep);
    if (!xTicks || !yTicks) return null;
    if ((xTicks.length > 1 && spec.xStep * unitScale < 22) || (yTicks.length > 1 && spec.yStep * unitScale < 18)) return null;
    const xAxisIncludesZero = xTicks.some(({ value }) => value === 0);

    for (const { value, label } of xTicks) {
        const x = mapX(value);
        content.push(line(x, top, x, bottom, { color: COLORS.gray, width: 1 }));
        content.push(labels.text(x, bottom + 30, label, { size: 15, maxWidth: 48 }));
    }
    for (const { value, label } of yTicks) {
        const y = mapY(value);
        content.push(line(left, y, right, y, { color: COLORS.gray, width: 1 }));
        // 仅在横轴已标出原点时隐藏纵轴的重复零标签。
        if (value !== 0 || !xAxisIncludesZero) content.push(labels.text(left - 18, y + 5, label, { size: 15, maxWidth: 42, anchor: 'end' }));
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
    if (layout.baseExtension) {
        const from = map(layout.baseExtension.from);
        const to = map(layout.baseExtension.to);
        content.push(`<g data-area-part="base-extension">${labels.line(from.x, from.y, to.x, to.y, { dashed: true, width: 1.8 })}</g>`);
    }
    // 顶点落在底边端点时，高本身就是三角形外边；保留外边实线，避免再叠画一条虚线。
    const heightIsBoundary = spec.shape === 'triangle' && (spec.apexRatio === 0 || spec.apexRatio === 1);
    if (!heightIsBoundary) content.push(`<g data-area-part="height">${labels.line(heightFrom.x, heightFrom.y, heightTo.x, heightTo.y, { dashed: true, width: 1.8 })}</g>`);
    if (Math.abs(heightFrom.y - heightTo.y) >= 18) {
        const baseLeft = Math.min(polygon[0]!.x, heightFrom.x);
        const baseRight = Math.max(polygon[1]!.x, heightFrom.x);
        const direction = heightFrom.x + 10 <= baseRight ? 1 : -1;
        const markSize = Math.min(10, Math.abs(heightFrom.y - heightTo.y) * 0.22);
        const markX = heightFrom.x + direction * markSize;
        const markY = heightFrom.y - markSize;
        content.push(`<g data-area-part="right-angle">${path(
            `M ${finite(heightFrom.x)} ${finite(markY)} L ${finite(markX)} ${finite(markY)} L ${finite(markX)} ${finite(heightFrom.y)}`,
            { width: 1.6 },
        )}</g>`);
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

interface SolidBoxProjection {
    frontBottomLeft: SolidGeometryPoint;
    frontBottomRight: SolidGeometryPoint;
    frontTopLeft: SolidGeometryPoint;
    frontTopRight: SolidGeometryPoint;
    backBottomLeft: SolidGeometryPoint;
    backBottomRight: SolidGeometryPoint;
    backTopLeft: SolidGeometryPoint;
    backTopRight: SolidGeometryPoint;
}

function projectSolidBox(
    width: number,
    depth: number,
    height: number,
    scale: number,
    origin: SolidGeometryPoint,
): SolidBoxProjection {
    const projectedWidth = width * scale;
    const depthX = depth * scale * 0.56;
    const depthY = depth * scale * 0.32;
    const projectedHeight = height * scale;
    const frontBottomLeft = origin;
    const frontBottomRight = { x: origin.x + projectedWidth, y: origin.y };
    const frontTopLeft = { x: origin.x, y: origin.y - projectedHeight };
    const frontTopRight = { x: origin.x + projectedWidth, y: origin.y - projectedHeight };
    const backBottomLeft = { x: origin.x + depthX, y: origin.y - depthY };
    const backBottomRight = { x: origin.x + projectedWidth + depthX, y: origin.y - depthY };
    const backTopLeft = { x: origin.x + depthX, y: origin.y - depthY - projectedHeight };
    const backTopRight = { x: origin.x + projectedWidth + depthX, y: origin.y - depthY - projectedHeight };
    return {
        frontBottomLeft, frontBottomRight, frontTopLeft, frontTopRight,
        backBottomLeft, backBottomRight, backTopLeft, backTopRight,
    };
}

function pointOnSolidPolygonEdge(point: SolidGeometryPoint, from: SolidGeometryPoint, to: SolidGeometryPoint): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const cross = (point.x - from.x) * dy - (point.y - from.y) * dx;
    if (Math.abs(cross) > 1e-7) return false;
    const dot = (point.x - from.x) * dx + (point.y - from.y) * dy;
    return dot >= -1e-7 && dot <= dx * dx + dy * dy + 1e-7;
}

function solidPolygonContainsPoint(polygon: SolidGeometryPoint[], point: SolidGeometryPoint): boolean {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const from = polygon[previous]!;
        const to = polygon[index]!;
        if (pointOnSolidPolygonEdge(point, from, to)) return true;
        if ((from.y > point.y) !== (to.y > point.y)
            && point.x < (to.x - from.x) * (point.y - from.y) / (to.y - from.y) + from.x) inside = !inside;
    }
    return inside;
}

/** Return only line sections not covered by the later-painted solid polygons. */
function getUncoveredSolidSegmentParts(
    from: SolidGeometryPoint,
    to: SolidGeometryPoint,
    occluders: SolidGeometryPoint[][],
): Array<[SolidGeometryPoint, SolidGeometryPoint]> {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-8) return [];
    const parameters = [0, 1];
    const cross = (first: SolidGeometryPoint, second: SolidGeometryPoint) => first.x * second.y - first.y * second.x;

    for (const polygon of occluders) {
        for (let index = 0; index < polygon.length; index += 1) {
            const edgeFrom = polygon[index]!;
            const edgeTo = polygon[(index + 1) % polygon.length]!;
            const edgeX = edgeTo.x - edgeFrom.x;
            const edgeY = edgeTo.y - edgeFrom.y;
            const offset = { x: edgeFrom.x - from.x, y: edgeFrom.y - from.y };
            const denominator = cross({ x: dx, y: dy }, { x: edgeX, y: edgeY });
            if (Math.abs(denominator) > 1e-9) {
                const segmentT = cross(offset, { x: edgeX, y: edgeY }) / denominator;
                const edgeT = cross(offset, { x: dx, y: dy }) / denominator;
                if (segmentT >= -1e-8 && segmentT <= 1 + 1e-8 && edgeT >= -1e-8 && edgeT <= 1 + 1e-8) {
                    parameters.push(Math.max(0, Math.min(1, segmentT)));
                }
            } else if (Math.abs(cross(offset, { x: dx, y: dy })) <= 1e-7) {
                for (const point of [edgeFrom, edgeTo]) {
                    const segmentT = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
                    if (segmentT >= -1e-8 && segmentT <= 1 + 1e-8) parameters.push(Math.max(0, Math.min(1, segmentT)));
                }
            }
        }
    }

    const sorted = parameters.sort((first, second) => first - second)
        .filter((value, index, values) => index === 0 || value - values[index - 1]! > 1e-8);
    const pointAt = (parameter: number): SolidGeometryPoint => ({ x: from.x + dx * parameter, y: from.y + dy * parameter });
    const visible: Array<[SolidGeometryPoint, SolidGeometryPoint]> = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
        const start = sorted[index]!;
        const end = sorted[index + 1]!;
        if (end - start < 1e-8) continue;
        const midpoint = pointAt((start + end) / 2);
        if (occluders.some((polygon) => solidPolygonContainsPoint(polygon, midpoint))) continue;
        visible.push([pointAt(start), pointAt(end)]);
    }
    return visible;
}

function renderStackedSolid(spec: z.infer<typeof stackedSolidSchema>): FigureDrawing | null {
    const totalHeight = spec.base.height + spec.top.height;
    const maximumPlanDimension = Math.max(spec.base.width, spec.base.depth, spec.top.width, spec.top.depth);
    const scale = Math.min(190 / maximumPlanDimension, 250 / totalHeight);
    if (!Number.isFinite(scale) || scale <= 0) return null;

    const baseWidth = spec.base.width * scale;
    const baseDepthX = spec.base.depth * scale * 0.56;
    const baseDepthY = spec.base.depth * scale * 0.32;
    const topDepthY = spec.top.depth * scale * 0.32;
    const baseOrigin: SolidGeometryPoint = {
        x: 400 - (baseWidth + baseDepthX) / 2,
        y: 395 + baseDepthY / 2,
    };
    const base = projectSolidBox(spec.base.width, spec.base.depth, spec.base.height, scale, baseOrigin);
    const topWidth = spec.top.width * scale;
    const topDepthX = spec.top.depth * scale * 0.56;
    const topOrigin: SolidGeometryPoint = {
        x: 400 - (topWidth + topDepthX) / 2,
        y: base.frontTopLeft.y - (baseDepthY - topDepthY) / 2,
    };
    const top = projectSolidBox(spec.top.width, spec.top.depth, spec.top.height, scale, topOrigin);
    const allPoints = Object.values(base).concat(Object.values(top));
    if (allPoints.some((point) => point.x < 30 || point.x > 770 || point.y < 30 || point.y > 470)) return null;
    const topOccludingFaces = [
        [top.frontTopLeft, top.frontTopRight, top.frontBottomRight, top.frontBottomLeft],
        [top.frontTopRight, top.backTopRight, top.backBottomRight, top.frontBottomRight],
        [top.frontTopLeft, top.backTopLeft, top.backTopRight, top.frontTopRight],
    ];

    const pointList = (points: SolidGeometryPoint[]) => points.map((point) => `${finite(point.x)},${finite(point.y)}`).join(' ');
    const labels = createGeometryLabelLayout(12);
    const content: string[] = [];
    const baseFill = spec.fill === 'gray' ? COLORS.gray : spec.fill === 'lightblue' ? COLORS.lightBlue : '#fff';
    const sideFill = spec.fill === 'gray' ? '#d1d5db' : spec.fill === 'lightblue' ? '#bfdbfe' : '#f3f4f6';
    const topFill = spec.fill === 'gray' ? '#f3f4f6' : spec.fill === 'lightblue' ? '#eff6ff' : '#fff';

    const drawBox = (box: SolidBoxProjection, part: 'base' | 'top') => {
        const boxContent: string[] = [];
        boxContent.push(`<polygon points="${pointList([box.frontTopLeft, box.frontTopRight, box.frontBottomRight, box.frontBottomLeft])}" fill="${baseFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
        boxContent.push(`<polygon points="${pointList([box.frontTopRight, box.backTopRight, box.backBottomRight, box.frontBottomRight])}" fill="${sideFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
        boxContent.push(`<polygon points="${pointList([box.frontTopLeft, box.backTopLeft, box.backTopRight, box.frontTopRight])}" fill="${topFill}" stroke="${COLORS.black}" stroke-width="2"/>`);
        const visibleEdges: Array<[SolidGeometryPoint, SolidGeometryPoint]> = [
            [box.frontBottomLeft, box.frontBottomRight], [box.frontBottomRight, box.frontTopRight],
            [box.frontTopRight, box.frontTopLeft], [box.frontTopLeft, box.frontBottomLeft],
            [box.frontTopLeft, box.backTopLeft], [box.backTopLeft, box.backTopRight],
            [box.backTopRight, box.frontTopRight], [box.backTopRight, box.backBottomRight],
            [box.backBottomRight, box.frontBottomRight],
        ];
        for (const [from, to] of visibleEdges) {
            boxContent.push(part === 'base' ? line(from.x, from.y, to.x, to.y) : labels.line(from.x, from.y, to.x, to.y));
            if (part === 'base') {
                for (const [visibleFrom, visibleTo] of getUncoveredSolidSegmentParts(from, to, topOccludingFaces)) {
                    labels.segment(visibleFrom, visibleTo);
                }
            }
        }
        if (part === 'base') {
            const hiddenEdges: Array<[SolidGeometryPoint, SolidGeometryPoint]> = [
                [box.backBottomLeft, box.backBottomRight],
                [box.frontBottomLeft, box.backBottomLeft],
                [box.backBottomLeft, box.backTopLeft],
            ];
            for (const [from, to] of hiddenEdges) {
                boxContent.push(line(from.x, from.y, to.x, to.y, { dashed: true, width: 1.8 }));
                for (const [visibleFrom, visibleTo] of getUncoveredSolidSegmentParts(from, to, topOccludingFaces)) {
                    labels.segment(visibleFrom, visibleTo);
                }
            }
        }
        content.push(`<g data-stacked-solid-part="${part}">${boxContent.join('')}</g>`);
    };

    // 先画底物体，再画顶物体，顶物体始终落在底物体的上表面并覆盖其内部遮挡线。
    drawBox(base, 'base');
    drawBox(top, 'top');
    const addLabels = (
        box: SolidBoxProjection,
        part: z.infer<typeof stackedSolidPartSchema>,
        topPart: boolean,
    ) => {
        if (part.widthLabel) {
            if (topPart) {
                // 顶物体的正面底边位于底物体上表面内部，标签放在正面中央并参与碰撞检查。
                const x = (box.frontTopLeft.x + box.frontTopRight.x) / 2;
                const y = box.frontTopLeft.y + (box.frontBottomLeft.y - box.frontTopLeft.y) * 0.62;
                content.push(labels.text(x, y, part.widthLabel, { size: 12, maxWidth: 150 }));
            } else {
                labels.segmentLabel(box.frontBottomLeft, box.frontBottomRight, part.widthLabel, { size: 15, maxWidth: 150 }, { x: 0, y: 1 });
            }
        }
        if (part.heightLabel) {
            if (topPart) {
                const x = Math.max(box.backBottomRight.x, base.backBottomRight.x) + 14;
                content.push(labels.text(x, (box.frontTopLeft.y + box.frontBottomLeft.y) / 2 + 6, part.heightLabel, { size: 15, maxWidth: 110, anchor: 'start' }));
            } else {
                labels.segmentLabel(box.frontTopLeft, box.frontBottomLeft, part.heightLabel, { size: 15, maxWidth: 110 }, { x: -1, y: 0 });
            }
        }
        if (part.depthLabel) {
            if (topPart) {
                content.push(labels.text(box.backTopRight.x + 22, box.backTopRight.y - 8, part.depthLabel, { size: 15, maxWidth: 130, anchor: 'start' }));
            } else {
                labels.segmentLabel(box.frontBottomRight, box.backBottomRight, part.depthLabel, { size: 15, maxWidth: 130 }, { x: 1, y: 1 });
            }
        }
    };
    addLabels(base, spec.base, false);
    addLabels(top, spec.top, true);
    if (spec.title) labels.title(spec.title);
    const renderedLabels = labels.renderLabels([], { size: 18, maxWidth: 150, radius: 0 });
    if (!renderedLabels) return null;
    content.push(renderedLabels.svg);
    return root(content.join(''), 500, renderedLabels.viewport);
}

function renderSolidNet(spec: z.infer<typeof solidNetSchema>): FigureDrawing | null {
    if (!validateCubeNetCells(spec.cells)) return null;
    const minRow = Math.min(...spec.cells.map((cell) => cell.row));
    const maxRow = Math.max(...spec.cells.map((cell) => cell.row));
    const minCol = Math.min(...spec.cells.map((cell) => cell.col));
    const maxCol = Math.max(...spec.cells.map((cell) => cell.col));
    const rows = maxRow - minRow + 1;
    const cols = maxCol - minCol + 1;
    const titleSize = spec.title ? fitFontSize(spec.title, 22, 700) : 22;
    if (titleSize < 12) return null;

    const cell = Math.floor(Math.min(96, 650 / cols, 420 / rows));
    if (cell < 42) return null;
    const width = cols * cell;
    const height = rows * cell;
    const top = spec.title ? 92 : 62;
    const bottom = top + height;
    const figureHeight = Math.ceil(Math.max(500, bottom + 34));
    if (figureHeight > 800) return null;

    const content: string[] = [];
    if (spec.title) content.push(text(400, 35, spec.title, { size: titleSize, maxWidth: 700, title: true }));
    const byPosition = new Map(spec.cells.map((cellInfo) => [`${cellInfo.row},${cellInfo.col}`, cellInfo]));
    for (const row of Array.from({ length: rows }, (_, index) => minRow + index)) {
        for (const col of Array.from({ length: cols }, (_, index) => minCol + index)) {
            const cellInfo = byPosition.get(`${row},${col}`);
            if (!cellInfo) continue;
            const x = 400 - width / 2 + (col - minCol) * cell;
            const y = top + (row - minRow) * cell;
            content.push(`<rect data-figure-net-cell="${row},${col}" x="${finite(x)}" y="${finite(y)}" width="${finite(cell)}" height="${finite(cell)}" fill="${COLORS.lightBlue}" stroke="${COLORS.black}" stroke-width="2"/>`);
            if (cellInfo.label) {
                const size = fitFontSize(cellInfo.label, 20, cell * 0.78);
                if (size < 12) return null;
                content.push(text(x + cell / 2, y + cell / 2 + size * 0.35, cellInfo.label, { size, maxWidth: cell * 0.78 }));
            }
        }
    }
    return root(content.join(''), figureHeight);
}

function renderRoundSolid(spec: RoundSolidSpec): FigureDrawing | null {
    const projection = projectRoundSolid(spec);
    if (!projection) return null;
    const { center, top, rx, ry, left, right, tangentAngle } = projection;
    const labels = createGeometryLabelLayout(12);
    const content: string[] = [];
    const point = (value: FigurePoint) => `${finite(value.x)} ${finite(value.y)}`;
    const fill = spec.fill === 'gray' ? COLORS.gray : spec.fill === 'lightblue' ? COLORS.lightBlue : '#fff';
    const part = (name: string, svg: string) => `<g data-round-solid-part="${name}">${svg}</g>`;
    const arc = (origin: FigurePoint, start: number, delta: number, dashed = false) => {
        const at = (angle: number) => ({ x: origin.x + rx * Math.cos(angle), y: origin.y + ry * Math.sin(angle) });
        // 弧段与实际路径共同登记，曲线不能从文字避让和画布边界检查中漏掉。
        const count = Math.ceil(Math.abs(delta) / (Math.PI / 36));
        for (let index = 0; index < count; index++) labels.segment(at(start + delta * index / count), at(start + delta * (index + 1) / count));
        return path(`M ${point(at(start))} A ${finite(rx)} ${finite(ry)} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta > 0 ? 1 : 0} ${point(at(start + delta))}`, { dashed });
    };
    if (spec.shape === 'cylinder') {
        content.push(part('body', path(`M ${finite(center.x - rx)} ${finite(top.y)} L ${point(left)} A ${finite(rx)} ${finite(ry)} 0 0 0 ${point(right)} L ${finite(center.x + rx)} ${finite(top.y)} Z`, { fill, width: 0 })));
        const topFill = spec.fill === 'gray' ? '#f3f4f6' : spec.fill === 'lightblue' ? '#eff6ff' : '#fff';
        content.push(part('top-face', path(`M ${finite(center.x - rx)} ${finite(top.y)} A ${finite(rx)} ${finite(ry)} 0 0 1 ${finite(center.x + rx)} ${finite(top.y)} A ${finite(rx)} ${finite(ry)} 0 0 1 ${finite(center.x - rx)} ${finite(top.y)} Z`, { fill: topFill, width: 0 })));
        content.push(part('left-edge', labels.line(center.x - rx, top.y, left.x, left.y)));
        content.push(part('right-edge', labels.line(center.x + rx, top.y, right.x, right.y)));
        content.push(part('top-back', arc(top, Math.PI, Math.PI)));
        content.push(part('top-front', arc(top, Math.PI, -Math.PI)));
    } else {
        content.push(part('body', path(`M ${point(top)} L ${point(left)} A ${finite(rx)} ${finite(ry)} 0 1 0 ${point(right)} Z`, { fill, width: 0 })));
        content.push(part('left-edge', labels.line(top.x, top.y, left.x, left.y)));
        content.push(part('right-edge', labels.line(top.x, top.y, right.x, right.y)));
        content.push(part('axis', labels.line(top.x, top.y, center.x, center.y, { dashed: true, width: 1.6 })));
        content.push(part('base-radius', labels.line(center.x, center.y, center.x + rx, center.y, { dashed: true, width: 1.6 })));
        const mark = Math.min(10, ry / 2);
        content.push(part('right-angle', path(`M ${finite(center.x)} ${finite(center.y - mark)} L ${finite(center.x + mark)} ${finite(center.y - mark)} L ${finite(center.x + mark)} ${finite(center.y)}`, { width: 1.5 })));
        labels.segment({ x: center.x, y: center.y - mark }, { x: center.x + mark, y: center.y - mark });
        labels.segment({ x: center.x + mark, y: center.y - mark }, { x: center.x + mark, y: center.y });
        if (spec.slantLabel) labels.segmentLabel(top, right, spec.slantLabel, { size: 18, maxWidth: 140 }, { x: 1, y: -1 });
    }
    const backStart = -Math.PI + tangentAngle;
    content.push(part('base-back', arc(center, backStart, Math.PI - 2 * tangentAngle, true)));
    content.push(part('base-front', arc(center, backStart, -Math.PI - 2 * tangentAngle)));

    // 半径、直径和高使用各自的尺寸线，避免把椭圆弧或圆锥斜边当成目标长度。
    const extension = (from: FigurePoint, to: FigurePoint) => labels.line(from.x, from.y, to.x, to.y, { dashed: true, width: 1, color: '#6b7280' });
    if (spec.heightLabel) {
        const x = center.x - rx - 36;
        const from = { x, y: top.y };
        const to = { x, y: center.y };
        content.push(part('height', labels.line(from.x, from.y, to.x, to.y)
            + extension({ x: spec.shape === 'cone' ? top.x : center.x - rx, y: top.y }, { x: x - 4, y: top.y })
            + extension({ x: spec.shape === 'cone' ? center.x : center.x - rx, y: center.y }, { x: x - 4, y: center.y })));
        labels.segmentLabel(from, to, spec.heightLabel, { size: 18, maxWidth: 120 }, { x: -1, y: 0 });
    }
    const dimensions = [
        { name: 'radius', value: spec.radiusLabel, from: center.x, y: center.y + ry + 28 },
        { name: 'diameter', value: spec.diameterLabel, from: center.x - rx, y: center.y + ry + (spec.radiusLabel ? 94 : 28) },
    ];
    for (const dimension of dimensions) {
        if (!dimension.value) continue;
        const from = { x: dimension.from, y: dimension.y };
        const to = { x: center.x + rx, y: dimension.y };
        content.push(part(dimension.name, labels.line(from.x, from.y, to.x, to.y)
            + extension({ x: from.x, y: center.y }, { x: from.x, y: dimension.y + 4 })
            + extension({ x: to.x, y: center.y }, { x: to.x, y: dimension.y + 4 })));
        labels.segmentLabel(from, to, dimension.value, { size: 18, maxWidth: 140 }, { x: 0, y: 1 });
    }
    if (spec.title) labels.title(spec.title);
    const rendered = labels.renderLabels([], { size: 18, maxWidth: 140, radius: 0 });
    if (!rendered) return null;
    return root(content.join('') + rendered.svg, 500, rendered.viewport);
}

function renderSphere(spec: SphereGeometrySpec): FigureDrawing | null {
    const center = { x: 400, y: 215 };
    const radius = 120;
    const labels = createGeometryLabelLayout(12);
    const part = (name: string, svg: string) => `<g data-sphere-part="${name}">${svg}</g>`;
    const fill = spec.fill === 'gray' ? COLORS.gray : spec.fill === 'lightblue' ? COLORS.lightBlue : '#fff';
    const content = [part('outline', `<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="${fill}" stroke="${COLORS.black}" stroke-width="2"/>`)];
    labels.circle(center, radius);
    for (const [name, direction] of [['equator-front', 1], ['equator-back', -1]] as const) {
        const ry = radius * 0.3;
        for (let index = 0; index < 36; index++) {
            const at = (step: number) => ({ x: center.x + radius * Math.cos(Math.PI * step / 36), y: center.y + ry * Math.sin(Math.PI * step / 36) * direction });
            labels.segment(at(index), at(index + 1));
        }
        content.push(part(name, path(`M ${center.x + radius} ${center.y} A ${radius} ${ry} 0 0 ${direction === 1 ? 1 : 0} ${center.x - radius} ${center.y}`, { dashed: direction === -1 })));
    }
    const dimensions = [
        { name: 'radius', value: spec.radiusLabel, from: center.x, y: center.y + radius + 28 },
        { name: 'diameter', value: spec.diameterLabel, from: center.x - radius, y: center.y + radius + (spec.radiusLabel ? 94 : 28) },
    ];
    for (const dimension of dimensions) {
        if (!dimension.value) continue;
        const from = { x: dimension.from, y: dimension.y };
        const to = { x: center.x + radius, y: dimension.y };
        const extension = (x: number) => labels.line(x, center.y, x, dimension.y + 4, { dashed: true, width: 1, color: '#6b7280' });
        content.push(part(dimension.name, labels.line(from.x, from.y, to.x, to.y) + extension(from.x) + extension(to.x)));
        // 球体的半径尺寸线只有 120px，长英文、分数和单位标签无法稳定放在线段中。
        // 标签固定放在线下方，尺寸线仍保留原始端点，避免改变图形比例或把标签挤出画布。
        const labelX = center.x;
        const labelY = dimension.y + 32;
        const labelSize = fitFontSize(dimension.value, 18, 220);
        content.push(labels.text(labelX, labelY, dimension.value, {
            size: labelSize,
            maxWidth: 220,
            fixedLabel: { x: labelX, y: labelY },
            segmentLabel: { from, to },
        }));
    }
    if (spec.title) labels.title(spec.title);
    const rendered = labels.renderLabels([], { size: 18, maxWidth: 140, radius: 0 });
    if (!rendered) return null;
    return root(content.join('') + rendered.svg, 500, rendered.viewport);
}

function renderVerticalDivision(spec: z.infer<typeof verticalArithmeticSchema>): FigureDrawing | null {
    const content: string[] = [];
    const size = 28;
    const cell = 30;
    const padding = 12;
    const rowGap = 42;
    const labelSize = 18;
    const isColumnToken = (value: string) => COLUMN_ARITHMETIC_TOKEN.test(value);
    const numberWidth = (value: string) => isColumnToken(value) ? displayLength(value) * cell : displayWidth(value) * size + 8;
    const values = [
        { value: spec.top, shift: 0 },
        { value: spec.bottom, shift: 0 },
        ...spec.divisionSteps.flatMap((step) => [
            { value: step.value, shift: step.shift }, { value: step.subtract, shift: step.shift },
        ]),
        ...(spec.result ? [{ value: spec.result, shift: 0 }] : []),
        ...(spec.remainder ? [{ value: spec.remainder, shift: 0 }] : []),
    ];
    const numberSpan = Math.max(...values.map(({ value, shift }) => numberWidth(value) + shift * cell),
        ...(spec.remainder ? [displayWidth(`余数 ${spec.remainder}`) * 20 + 8] : []));
    const labelWidth = Math.max(0, ...spec.divisionSteps.map((step) => displayWidth(step.label ?? '') * labelSize));
    const labelColumn = Math.max(32, labelWidth ? labelWidth + 16 : 0);
    const divisorWidth = numberWidth(spec.bottom);
    const numberLeft = padding + labelColumn + divisorWidth + 34;
    const right = numberLeft + numberSpan;
    const width = Math.max(240, right + padding);
    if (width > 800) return null;
    const drawNumber = (value: string, y: number, role: string, shift = 0, rightEdge = right) => {
        // 每个数位使用独立文字锚点，长除法的商、被除数和减数保持同一列网格。
        const columns = isColumnToken(value);
        const unitX = rightEdge - cell / 2;
        const positions = columns
            ? Array.from(value, (_, index) => unitX - (displayLength(value) - 1 - index + shift) * cell).join(' ')
            : String(rightEdge - shift * cell);
        content.push(`<text x="${positions}" y="${y}" text-anchor="${columns ? 'middle' : 'end'}" font-size="${size}" fill="${COLORS.black}" data-arithmetic-row="${role}" data-arithmetic-shift="${shift}">${escapeXml(value)}</text>`);
    };

    const start = padding + size * 1.2;
    if (spec.result) drawNumber(spec.result, start, 'division-quotient');
    const dividendY = start + rowGap;
    drawNumber(spec.bottom, dividendY, 'division-divisor', 0, numberLeft - 16);
    drawNumber(spec.top, dividendY, 'division-dividend');
    const bracketX = numberLeft - 2;
    const bracketTop = dividendY - size - 8;
    content.push(`<path d="M ${bracketX} ${bracketTop} Q ${bracketX - 14} ${bracketTop + 12} ${bracketX} ${bracketTop + 25}" fill="none" stroke="${COLORS.black}" stroke-width="2.5"/>`);
    content.push(line(bracketX, bracketTop, right, bracketTop, { width: 2.5 }));

    let lastRow = dividendY + 46;
    for (const [index, step] of spec.divisionSteps.entries()) {
        if (index > 0) lastRow += rowGap;
        if (step.label) content.push(text(padding + labelColumn, lastRow, step.label, { size: labelSize, anchor: 'end', weight: '600' }));
        drawNumber(step.value, lastRow, 'division-value', step.shift);
        const subtractY = lastRow + rowGap;
        drawNumber(step.subtract, subtractY, 'division-subtract', step.shift);
        content.push(line(numberLeft, subtractY + 14, right - step.shift * cell, subtractY + 14, { width: 1.8 }));
        lastRow = subtractY + 18;
    }
    if (spec.remainder) {
        lastRow += spec.divisionSteps.length > 0 ? 24 : 42;
        content.push(text(numberLeft, lastRow, `余数 ${spec.remainder}`, {
            size: 20, maxWidth: right - numberLeft, anchor: 'start', arithmeticRow: 'division-remainder', arithmeticShift: 0,
        }));
    }

    let bottom = Math.max(lastRow + size * 0.4, dividendY + 18);
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
    const useDecimalGrid = (spec.operation === '+' || spec.operation === '-')
        && spec.partialProducts.length === 0
        && values.some(({ value }) => value.includes('.'))
        && values.every(({ value }) => DECIMAL_GRID_TOKEN.test(value));
    const useMultiplicationGrid = spec.operation === '×'
        && values.some(({ value }) => value.includes('.'))
        && values.every(({ value }) => DECIMAL_GRID_TOKEN.test(value));
    const decimalColumns = useDecimalGrid
        ? values.map(({ value, shift }) => (getDecimalColumnPositions(value) ?? []).map((column) => column - shift))
        : [];
    const decimalMin = useDecimalGrid ? Math.min(...decimalColumns.flat()) : 0;
    const decimalMax = useDecimalGrid ? Math.max(...decimalColumns.flat()) : 0;
    const numberSpan = useDecimalGrid
        ? (decimalMax - decimalMin + 1) * cell
        : useMultiplicationGrid
            ? Math.max(...values.map(({ value, shift }) => displayLength(value.replace('.', '')) + shift)) * cell
        : Math.max(...values.map(({ value, shift }) => numberWidth(value) + shift * cell));
    const labelWidth = Math.max(0, ...spec.partialProducts.map((partial) => displayWidth(partial.label ?? '') * labelSize));
    const labelColumn = Math.max(32, labelWidth ? labelWidth + 16 : 0);
    const bodyWidth = padding * 2 + labelColumn + numberSpan;
    const width = spec.note ? Math.max(240, bodyWidth) : bodyWidth;
    if (width > 800) return null;
    const numberLeft = padding + labelColumn + (width - bodyWidth) / 2;
    const right = numberLeft + numberSpan;
    const unitX = right - cell / 2;
    const decimalX = useDecimalGrid ? right - (decimalMax + 0.5) * cell : 0;
    const drawNumber = (value: string, y: number, role: string, shift = 0) => {
        // 每个数位使用独立文字锚点，数字、字母和方框的字体宽度不会改变列对齐。
        const columns = useDecimalGrid || useMultiplicationGrid || isColumnToken(value);
        const positions = useDecimalGrid
            ? (getDecimalColumnPositions(value) ?? []).map((column) => decimalX + (column - shift) * cell).join(' ')
            : useMultiplicationGrid
                ? (getMultiplicationColumnOffsets(value) ?? []).map((offset) => right - (offset + shift) * cell).join(' ')
            : columns
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
        const numeratorSize = fitFontSize(spec.numerator, 32, 150);
        const denominatorSize = fitFontSize(spec.denominator, 32, 150);
        const fractionBarWidth = Math.max(
            110,
            Math.max(
                displayWidth(spec.numerator) * numeratorSize,
                displayWidth(spec.denominator) * denominatorSize,
            ) + 16,
        );
        if (spec.whole) content.push(text(295, 210, spec.whole, { size: 34, maxWidth: 120, anchor: 'end' }));
        content.push(text(center, 175, spec.numerator, { size: 32, maxWidth: 150 }));
        content.push(line(center - fractionBarWidth / 2, 195, center + fractionBarWidth / 2, 195, { width: 2.5 }));
        content.push(text(center, 240, spec.denominator, { size: 32, maxWidth: 150 }));
    }
    if (spec.label) content.push(text(400, 450, spec.label, { size: 20, maxWidth: 700 }));
    return root(content.join(''));
}

function renderNumberLine(spec: z.infer<typeof numberLineSchema>): FigureDrawing | null {
    const content: string[] = [];
    const labels = createGeometryLabelLayout();
    const x1 = 90;
    const x2 = 710;
    const y = 250;
    const range = spec.max - spec.min;
    content.push(labels.line(x1, y, x2, y, { width: 2.5 }));
    for (const offset of [-7, 7]) labels.segment({ x: x2, y }, { x: x2 - 12, y: y + offset });
    content.push(`<path d="M ${x2} ${y} L ${x2 - 12} ${y - 7} M ${x2} ${y} L ${x2 - 12} ${y + 7}" stroke="${COLORS.black}" stroke-width="2" fill="none"/>`);
    const values = createFigureAxisTicks(spec.min, spec.max, spec.step);
    if (!values) return null;
    const ticks = values.map((tick) => ({ ...tick, x: x1 + (tick.value - spec.min) / range * (x2 - x1) }));
    let tickSize = 18;
    for (; tickSize >= 12; tickSize -= 1) {
        let previousRight = Number.NEGATIVE_INFINITY;
        const fits = ticks.every((tick) => {
            const width = displayWidth(tick.label) * tickSize;
            const spaced = width <= 90 && tick.x - width / 2 >= previousRight + 3;
            previousRight = tick.x + width / 2;
            return spaced;
        });
        if (fits) break;
    }
    if (tickSize < 12) return null;
    for (const tick of ticks) {
        content.push(labels.line(tick.x, y - 10, tick.x, y + 10, { width: 1.5 }));
        content.push(labels.text(tick.x, y + 38, tick.label, { size: tickSize, maxWidth: 90 }));
    }
    const points = spec.points.map((point) => ({
        x: x1 + (point.value - spec.min) / range * (x2 - x1), y,
        label: point.label, color: COLORS[point.color ?? 'red'],
    }));
    for (const point of points) content.push(`<circle cx="${point.x}" cy="${point.y}" r="7" fill="${point.color}"/>`);
    if (spec.label) content.push(labels.text(400, 100, spec.label, { size: 22, maxWidth: 700 }));
    const renderedLabels = labels.renderLabels(points, { size: 20, maxWidth: 100, radius: 7 });
    if (!renderedLabels) return null;
    content.push(renderedLabels.svg);
    return root(content.join(''), 500, renderedLabels.viewport);
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
    const domain = getFigureChartDomain(spec);
    if (!domain) return null;
    const { min: minValue, max: maxValue } = domain;
    const x = 100;
    const y = 70;
    const width = 600;
    const height = 330;
    const categoryMaxWidth = isBar ? (width / spec.categories.length) * 0.58 : (width / values.length) * 0.9;
    if (spec.categories.some((category) => !wrappedLinesFit(wrapTextLines(category, 16, categoryMaxWidth), 16, categoryMaxWidth))) return null;
    if ((spec.title && fitFontSize(spec.title, 22, 700) < 12)
        || (spec.unit && fitFontSize(spec.unit, 18, 55) < 12)) return null;
    if (isBar && values.some((value) => fitFontSize(String(value), 16, (width / spec.categories.length) * 0.58) < 12)) return null;
    content.push(line(x, y + height, x + width, y + height, { width: 2 }));
    content.push(line(x, y, x, y + height, { width: 2 }));
    if (spec.title) content.push(text(400, 35, spec.title, { size: 22, maxWidth: 700 }));
    const scale = (value: number) => y + height - (value - minValue) / (maxValue - minValue) * height;
    const axisTicks = spec.tickStep === undefined ? [] : createFigureAxisTicks(minValue, maxValue, spec.tickStep);
    if (spec.tickStep !== undefined && (!axisTicks || axisTicks.length < 2)) return null;
    const axisTickLayout = chartAxisTickLayout(axisTicks ?? [], x, scale);
    if (spec.tickStep !== undefined && !axisTickLayout) return null;
    renderChartAxisTicks(content, axisTickLayout, x);
    if (isBar) {
        const slot = width / spec.categories.length;
        const bars = values.map((value, index) => {
            const barHeight = Math.max(0, y + height - scale(value));
            const barWidth = slot * 0.58;
            const barX = x + index * slot + (slot - barWidth) / 2;
            return { value, barHeight, barWidth, barX, barY: y + height - barHeight, centerX: barX + barWidth / 2 };
        });
        const categoryBoxes = bars.map((bar, index) => chartWrappedTextBox(
            bar.centerX, y + height + 28, spec.categories[index]!, 16, bar.barWidth,
        ));
        if (categoryBoxes.some((box) => box === null)) return null;
        const titleBox = spec.title ? chartTextBox(400, 35, spec.title, 22, 700) : null;
        const unitBox = spec.unit ? chartTextBox(735, 70, spec.unit, 18, 55, 'start') : null;
        if ((spec.title && !titleBox) || (spec.unit && !unitBox)) return null;
        const valueLabels = bars.map((bar) => {
            const size = fitFontSize(String(bar.value), 16, bar.barWidth);
            return {
                x: bar.centerX,
                y: bar.barY,
                width: displayWidth(String(bar.value)) * size,
                height: size * 1.6,
                size,
            };
        });
        if (valueLabels.some((label) => label.size < 12)) return null;
        const barObstacles: FigureLabelObstacle[] = bars.filter((bar) => bar.barHeight > 0).map((bar) => ({
            type: 'box', box: { left: bar.barX, top: bar.barY, width: bar.barWidth, height: bar.barHeight },
        }));
        const axisObstacles: FigureLabelObstacle[] = [
            { type: 'segment', from: { x, y: y + height }, to: { x: x + width, y: y + height } },
            { type: 'segment', from: { x, y }, to: { x, y: y + height } },
        ];
        const valueLayout = layoutFigureGeometryLabels(
            valueLabels,
            [],
            [...barObstacles, ...axisObstacles],
            [],
            { left: 8, top: 8, width: 784, height: 484 },
            { fixed: [
                ...(axisTickLayout?.boxes ?? []),
                ...categoryBoxes.map((box) => box!),
                ...(titleBox ? [titleBox] : []),
                ...(unitBox ? [unitBox] : []),
            ] },
        );
        if (!valueLayout) return null;
        bars.forEach((bar, index) => {
            content.push(`<rect x="${bar.barX}" y="${bar.barY}" width="${bar.barWidth}" height="${bar.barHeight}" fill="${COLORS.lightBlue}" stroke="${COLORS.black}" stroke-width="1.5"/>`);
            content.push(textWithLineWrap(bar.centerX, y + height + 28, spec.categories[index]!, { size: 16, maxWidth: bar.barWidth }));
            const label = valueLabels[index]!;
            const box = valueLayout.points[index]!;
            content.push(text(box.left + box.width / 2, box.top + label.size * 1.2, String(bar.value), {
                size: label.size, maxWidth: bar.barWidth,
            }));
        });
    } else {
        // 折线首尾留出内边距，避免数据点和纵轴、右侧单位标注重叠。
        const plotInset = Math.min(32, width / (values.length * 2));
        const plotWidth = width - plotInset * 2;
        const points = values.map((value, index) => ({ x: x + plotInset + index * plotWidth / (values.length - 1), y: scale(value) }));
        if (values.some((value) => fitFontSize(String(value), 16, 80) < 12)) return null;
        const categoryBoxes = points.map((point, index) => chartWrappedTextBox(
            point.x, y + height + 28, spec.categories[index]!, 16, width / values.length * 0.9,
        ));
        if (categoryBoxes.some((box) => box === null)) return null;
        const titleBox = spec.title ? chartTextBox(400, 35, spec.title, 22, 700) : null;
        const unitBox = spec.unit ? chartTextBox(735, 70, spec.unit, 18, 55, 'start') : null;
        if ((spec.title && !titleBox) || (spec.unit && !unitBox)) return null;
        const valueSizes = values.map((value) => fitFontSize(String(value), 16, 80));
        const valueLabels = points.map((point, index) => ({
            x: point.x,
            y: point.y,
            width: displayWidth(String(values[index])) * valueSizes[index]!,
            height: valueSizes[index]! * 1.6,
        }));
        const lineObstacles: FigureLabelObstacle[] = points.slice(1).map((point, index) => ({
            type: 'segment', from: points[index]!, to: point,
        }));
        const pointObstacles: FigureLabelObstacle[] = points.map((point) => ({
            type: 'circle', center: point, radius: 5, solid: true,
        }));
        const axisObstacles: FigureLabelObstacle[] = [
            { type: 'segment', from: { x, y: y + height }, to: { x: x + width, y: y + height } },
            { type: 'segment', from: { x, y }, to: { x, y: y + height } },
        ];
        const valueLayout = layoutFigureGeometryLabels(
            valueLabels,
            [],
            [...lineObstacles, ...pointObstacles, ...axisObstacles],
            [],
            { left: 8, top: 8, width: 784, height: 484 },
            { fixed: [
                ...(axisTickLayout?.boxes ?? []),
                ...categoryBoxes.map((box) => box!),
                ...(titleBox ? [titleBox] : []),
                ...(unitBox ? [unitBox] : []),
            ] },
        );
        if (!valueLayout) return null;
        content.push(`<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${COLORS.blue}" stroke-width="3"/>`);
        points.forEach((point, index) => {
            content.push(`<circle cx="${point.x}" cy="${point.y}" r="5" fill="${COLORS.blue}"/>`);
            content.push(textWithLineWrap(point.x, y + height + 28, spec.categories[index]!, { size: 16, maxWidth: width / values.length * 0.9 }));
            const box = valueLayout.points[index]!;
            content.push(text(box.left + box.width / 2, box.top + valueSizes[index]! * 1.2, String(values[index]), {
                size: valueSizes[index], maxWidth: 80, color: COLORS.blue,
            }));
        });
    }
    if (spec.unit) content.push(text(735, 70, spec.unit, { size: 18, maxWidth: 55, anchor: 'start' }));
    return root(content.join(''));
}

const PIE_FILLS = ['#dbeafe', '#e5e7eb', '#bfdbfe', '#9ca3af', '#93c5fd', '#6b7280', '#d1d5db', '#4b5563'];

function renderPieChart(spec: z.infer<typeof pieChartSchema>): FigureDrawing | null {
    const total = spec.values.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) return null;

    const center = { x: 245, y: 260 };
    const radius = 145;
    const legendX = 475;
    const legendWidth = 290;
    const titleBox = spec.title ? chartTextBox(400, 35, spec.title, 22, 700) : null;
    if ((spec.title && !titleBox) || (spec.unit && fitFontSize(spec.unit, 18, 100) < 12)) return null;

    const legend = spec.categories.map((category, index) => {
        const value = spec.values[index]!;
        const valueText = `${category}：${String(value)}${spec.unit ? ` ${spec.unit}` : ''}`;
        const lines = wrapTextLines(valueText, 16, legendWidth);
        if (!wrappedLinesFit(lines, 16, legendWidth)) return null;
        return { valueText, lines, height: Math.max(28, lines.length * textLineGap(16) + 6) };
    });
    if (legend.some((entry) => entry === null)) return null;
    const legendEntries = legend as Array<{ valueText: string; lines: string[]; height: number }>;
    const legendHeight = legendEntries.reduce((sum, entry) => sum + entry.height, 0);
    if (legendHeight > 390) return null;

    const content: string[] = [];
    let angle = -Math.PI / 2;
    spec.values.forEach((value, index) => {
        if (value <= 0) return;
        const delta = value / total * Math.PI * 2;
        const endAngle = angle + delta;
        const start = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
        const end = { x: center.x + Math.cos(endAngle) * radius, y: center.y + Math.sin(endAngle) * radius };
        const fill = PIE_FILLS[index]!;
        if (delta >= Math.PI * 2 - 0.0001) {
            content.push(`<circle cx="${finite(center.x)}" cy="${finite(center.y)}" r="${finite(radius)}" fill="${fill}" stroke="${COLORS.black}" stroke-width="2"/>`);
        } else {
            content.push(path(
                `M ${finite(center.x)} ${finite(center.y)} L ${finite(start.x)} ${finite(start.y)} A ${finite(radius)} ${finite(radius)} 0 ${delta > Math.PI ? 1 : 0} 1 ${finite(end.x)} ${finite(end.y)} Z`,
                { fill, width: 2 },
            ));
        }
        angle = endAngle;
    });
    content.push(`<circle cx="${finite(center.x)}" cy="${finite(center.y)}" r="${finite(radius)}" fill="none" stroke="${COLORS.black}" stroke-width="2"/>`);
    if (spec.title) content.push(text(400, 35, spec.title, { size: 22, maxWidth: 700, title: true }));

    let legendY = 95;
    legendEntries.forEach((entry, index) => {
        const swatchY = legendY - 15;
        content.push(`<rect x="${finite(legendX)}" y="${finite(swatchY)}" width="18" height="18" fill="${PIE_FILLS[index]!}" stroke="${COLORS.black}" stroke-width="1"/>`);
        content.push(textWithLineWrap(legendX + 30, legendY, entry.valueText, { size: 16, maxWidth: legendWidth, anchor: 'start' }));
        legendY += entry.height;
    });
    return root(content.join(''));
}

type PictogramIcon = z.infer<typeof pictogramSchema>['icon'];

function renderPictogramIcon(icon: PictogramIcon, centerX: number, centerY: number, size = 24): string {
    const half = size / 2;
    const fill = COLORS.lightBlue;
    const stroke = COLORS.black;
    const strokeWidth = 1.6;
    const circle = (x: number, y: number, radius: number, color = fill) =>
        `<circle cx="${finite(x)}" cy="${finite(y)}" r="${finite(radius)}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    const rect = (x: number, y: number, width: number, height: number, color = fill) =>
        `<rect x="${finite(x)}" y="${finite(y)}" width="${finite(width)}" height="${finite(height)}" rx="2" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    const polygon = (points: Array<{ x: number; y: number }>, color = fill) =>
        `<polygon points="${points.map((point) => `${finite(point.x)},${finite(point.y)}`).join(' ')}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    const groupStart = `<g data-figure-pictogram-icon="${escapeXml(icon)}">`;
    switch (icon) {
        case 'person':
            return groupStart
                + circle(centerX, centerY - half * 0.28, half * 0.22)
                + `<path d="M ${finite(centerX - half * 0.38)} ${finite(centerY + half * 0.48)} Q ${finite(centerX - half * 0.34)} ${finite(centerY - half * 0.02)} ${finite(centerX)} ${finite(centerY - half * 0.02)} Q ${finite(centerX + half * 0.34)} ${finite(centerY - half * 0.02)} ${finite(centerX + half * 0.38)} ${finite(centerY + half * 0.48)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                + '</g>';
        case 'book':
            return groupStart
                + rect(centerX - half * 0.78, centerY - half * 0.62, half * 0.7, size * 0.76)
                + rect(centerX + half * 0.08, centerY - half * 0.62, half * 0.7, size * 0.76)
                + `<line x1="${finite(centerX)}" y1="${finite(centerY - half * 0.56)}" x2="${finite(centerX)}" y2="${finite(centerY + half * 0.56)}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                + '</g>';
        case 'apple':
            return groupStart
                + `<path d="M ${finite(centerX)} ${finite(centerY - half * 0.05)} C ${finite(centerX - half * 0.78)} ${finite(centerY - half * 0.72)} ${finite(centerX - half * 0.92)} ${finite(centerY + half * 0.64)} ${finite(centerX)} ${finite(centerY + half * 0.72)} C ${finite(centerX + half * 0.92)} ${finite(centerY + half * 0.64)} ${finite(centerX + half * 0.78)} ${finite(centerY - half * 0.72)} ${finite(centerX)} ${finite(centerY - half * 0.05)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                + `<path d="M ${finite(centerX)} ${finite(centerY - half * 0.56)} Q ${finite(centerX + half * 0.1)} ${finite(centerY - half * 0.96)} ${finite(centerX + half * 0.5)} ${finite(centerY - half * 0.82)} Q ${finite(centerX + half * 0.2)} ${finite(centerY - half * 0.42)} ${finite(centerX)} ${finite(centerY - half * 0.56)} Z" fill="${COLORS.green}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                + '</g>';
        case 'star': {
            const points = Array.from({ length: 10 }, (_, index) => {
                const angle = -Math.PI / 2 + index * Math.PI / 5;
                const radius = index % 2 === 0 ? half * 0.9 : half * 0.4;
                return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
            });
            return groupStart + polygon(points) + '</g>';
        }
        case 'flower':
            return groupStart
                + [0, 72, 144, 216, 288].map((degrees) => {
                    const angle = degrees * Math.PI / 180;
                    return circle(centerX + Math.cos(angle) * half * 0.38, centerY + Math.sin(angle) * half * 0.38, half * 0.3);
                }).join('')
                + circle(centerX, centerY, half * 0.25, '#fff')
                + '</g>';
        case 'car':
            return groupStart
                + rect(centerX - half * 0.82, centerY - half * 0.18, size * 0.82, half * 0.48)
                + polygon([
                    { x: centerX - half * 0.52, y: centerY - half * 0.18 },
                    { x: centerX - half * 0.25, y: centerY - half * 0.58 },
                    { x: centerX + half * 0.32, y: centerY - half * 0.58 },
                    { x: centerX + half * 0.62, y: centerY - half * 0.18 },
                ])
                + circle(centerX - half * 0.5, centerY + half * 0.36, half * 0.17, '#fff')
                + circle(centerX + half * 0.5, centerY + half * 0.36, half * 0.17, '#fff')
                + '</g>';
        case 'ball':
            return groupStart
                + circle(centerX, centerY, half * 0.82)
                + `<path d="M ${finite(centerX - half * 0.68)} ${finite(centerY - half * 0.45)} Q ${finite(centerX)} ${finite(centerY)} ${finite(centerX + half * 0.68)} ${finite(centerY + half * 0.45)} M ${finite(centerX + half * 0.68)} ${finite(centerY - half * 0.45)} Q ${finite(centerX)} ${finite(centerY)} ${finite(centerX - half * 0.68)} ${finite(centerY + half * 0.45)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                + '</g>';
        case 'tree':
            return groupStart
                + rect(centerX - half * 0.15, centerY + half * 0.08, half * 0.3, half * 0.72, '#d1a46c')
                + polygon([
                    { x: centerX, y: centerY - half * 0.88 },
                    { x: centerX - half * 0.82, y: centerY + half * 0.35 },
                    { x: centerX + half * 0.82, y: centerY + half * 0.35 },
                ], COLORS.green)
                + '</g>';
        case 'house':
            return groupStart
                + rect(centerX - half * 0.66, centerY - half * 0.12, size * 0.66, half * 0.76)
                + polygon([
                    { x: centerX - half * 0.84, y: centerY - half * 0.12 },
                    { x: centerX, y: centerY - half * 0.88 },
                    { x: centerX + half * 0.84, y: centerY - half * 0.12 },
                ])
                + rect(centerX - half * 0.14, centerY + half * 0.16, half * 0.28, half * 0.48, '#fff')
                + '</g>';
        case 'circle':
            return groupStart + circle(centerX, centerY, half * 0.78) + '</g>';
        case 'square':
            return groupStart + rect(centerX - half * 0.72, centerY - half * 0.72, size * 0.72, size * 0.72) + '</g>';
    }
}

function renderPictogram(spec: z.infer<typeof pictogramSchema>): FigureDrawing | null {
    const iconCounts = spec.values.map((value) => value / spec.perIcon);
    const maxIcons = Math.max(...iconCounts);
    if (!Number.isInteger(maxIcons) || maxIcons < 1 || maxIcons > 16) return null;

    const titleSize = spec.title ? fitFontSize(spec.title, 22, 700) : 22;
    const legendText = `图例：每个图标表示${spec.perIcon}${spec.unit ?? ''}`;
    const legendSize = fitFontSize(legendText, 16, 650);
    if (titleSize < 12 || legendSize < 12) return null;

    const rowGap = Math.max(44, Math.min(54, 360 / spec.categories.length));
    const firstRowY = spec.title ? 132 : 104;
    const lastRowY = firstRowY + (spec.categories.length - 1) * rowGap;
    if (lastRowY + 32 > 490) return null;

    const categoryWidth = 130;
    const iconSize = 24;
    const iconStep = 30;
    const iconStartX = 190;
    const valueX = 750;
    const categoryBoxes = spec.categories.map((category, index) =>
        chartWrappedTextBox(90, firstRowY + index * rowGap + 5, category, 16, categoryWidth));
    const valueTexts = spec.values.map((value) => `${value}${spec.unit ? ` ${spec.unit}` : ''}`);
    const valueBoxes = valueTexts.map((value, index) => chartTextBox(valueX, firstRowY + index * rowGap + 5, value, 16, 95, 'end'));
    if (categoryBoxes.some((box) => box === null) || valueBoxes.some((box) => box === null)) return null;

    const content: string[] = [];
    if (spec.title) content.push(text(400, 35, spec.title, { size: titleSize, maxWidth: 700, title: true }));
    content.push(renderPictogramIcon(spec.icon, 72, 72, 22));
    content.push(text(100, 78, legendText, { size: legendSize, maxWidth: 650, anchor: 'start' }));
    spec.categories.forEach((category, index) => {
        const rowY = firstRowY + index * rowGap;
        content.push(textWithLineWrap(90, rowY + 5, category, { size: 16, maxWidth: categoryWidth }));
        for (let iconIndex = 0; iconIndex < iconCounts[index]!; iconIndex += 1) {
            content.push(renderPictogramIcon(spec.icon, iconStartX + iconIndex * iconStep, rowY, iconSize));
        }
        content.push(text(valueX, rowY + 5, valueTexts[index]!, { size: 16, maxWidth: 95, anchor: 'end' }));
    });
    return root(content.join(''));
}

function chartAxisTickLayout(
    ticks: readonly FigureAxisTick[],
    axisX: number,
    yFor: (value: number) => number,
): { ticks: readonly FigureAxisTick[]; boxes: FigureLabelBox[] } | null {
    if (ticks.length === 0) return null;
    const boxes = ticks.map((tick) => chartTextBox(axisX - 12, yFor(tick.value) + 5, tick.label, 14, 72, 'end'));
    if (boxes.some((box) => box === null)) return null;
    const ordered = (boxes as FigureLabelBox[]).slice().sort((first, second) => first.top - second.top);
    for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1]!;
        const current = ordered[index]!;
        if (current.top < previous.top + previous.height + 2) return null;
    }
    return { ticks, boxes: boxes as FigureLabelBox[] };
}

function renderChartAxisTicks(
    content: string[],
    layout: { ticks: readonly FigureAxisTick[]; boxes: FigureLabelBox[] } | null,
    axisX: number,
): void {
    if (!layout) return;
    layout.ticks.forEach((tick, index) => {
        const box = layout.boxes[index]!;
        const size = fitFontSize(tick.label, 14, 72);
        const y = box.top + size * 1.2;
        const tickY = y - size * 0.35;
        content.push(line(axisX - 6, tickY, axisX, tickY, { width: 1 }));
        content.push(text(box.left + box.width, y, tick.label, { size, maxWidth: 72, anchor: 'end' }));
    });
}

function chartWrappedTextBox(x: number, baseline: number, value: string, size: number, maxWidth: number): FigureLabelBox | null {
    const lines = wrapTextLines(value, size, maxWidth);
    if (!wrappedLinesFit(lines, size, maxWidth)) return null;
    const width = Math.max(...lines.map((lineValue) => displayWidth(lineValue))) * size;
    const height = size * 1.6 + (lines.length - 1) * textLineGap(size);
    return { left: x - width / 2, top: baseline - size * 1.2, width, height };
}

function chartTextBox(
    x: number,
    baseline: number,
    value: string,
    size: number,
    maxWidth: number,
    anchor: 'start' | 'middle' | 'end' = 'middle',
): FigureLabelBox | null {
    const actualSize = fitFontSize(value, size, maxWidth);
    if (actualSize < 12) return null;
    const width = displayWidth(value) * actualSize;
    return {
        left: anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2,
        top: baseline - actualSize * 1.2,
        width,
        height: actualSize * 1.6,
    };
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
    const bodySize = Math.max(12, Math.min(17, 560 / (rows.length + 1) * 0.52));
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
        case 'vertical_arithmetic': return spec.operation === '÷'
            && COLUMN_ARITHMETIC_TOKEN.test(spec.top)
            && COLUMN_ARITHMETIC_TOKEN.test(spec.bottom)
            ? renderVerticalDivision(spec)
            : renderVerticalArithmetic(spec);
        case 'fraction': return renderFraction(spec);
        case 'number_line': return renderNumberLine(spec);
        case 'coordinate_plane': return renderCoordinatePlane(spec);
        case 'circle_geometry': return renderCircleGeometry(spec);
        case 'area_geometry': return renderAreaGeometry(spec);
        case 'solid_geometry': return renderSolidGeometry(spec);
        case 'stacked_solid': return renderStackedSolid(spec);
        case 'solid_net': return renderSolidNet(spec);
        case 'round_solid': return renderRoundSolid(spec);
        case 'sphere_geometry': return renderSphere(spec);
        case 'basic_geometry': return renderGeometry(spec);
        case 'bar_chart':
        case 'line_chart': return renderChart(spec);
        case 'pie_chart': return renderPieChart(spec);
        case 'pictogram': return renderPictogram(spec);
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
    if (hasUnreadableSvgText(svg)) return { svg: null, diagnostic: { ok: false, reason: 'renderer_unavailable', type: parsed.spec.type } };
    if (hasInvalidSvgNumber(svg)) return { svg: null, diagnostic: { ok: false, reason: 'invalid_svg_number', type: parsed.spec.type } };
    if (parsed.spec.type !== 'figure_group' && hasOutOfBoundsSvgGeometry(svg)) return { svg: null, diagnostic: { ok: false, reason: 'svg_geometry_out_of_bounds', type: parsed.spec.type } };
    return { svg, diagnostic: parsed.diagnostic };
}

/** 将结构化描述绘制为可安全显示的 SVG；任何格式或布局错误都不覆盖已有配图。 */
export function renderFigureSpec(raw: unknown, questionText?: string | null): string | null {
    return renderFigureSpecDetailed(raw, questionText).svg;
}

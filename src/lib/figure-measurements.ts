type NumericLabel =
    | { kind: 'number'; numerator: bigint; denominator: bigint }
    | { kind: 'invalid' | 'unknown' };

type LengthLabel =
    | { kind: 'length'; numerator: bigint; denominator: bigint; unit: 'metric' | 'unitless' }
    | { kind: 'invalid' | 'unknown' };

interface FigureLength {
    label?: string;
    multiple?: 1 | 2;
}

interface FigureSegmentLength {
    from: string;
    to: string;
    label?: string;
}

interface CircleLengths {
    radii: readonly { label?: string }[];
    diameters: readonly FigureSegmentLength[];
    chords: readonly FigureSegmentLength[];
}

const UNIT_MILLIMETERS: Record<string, number> = {
    mm: 1, 毫米: 1,
    cm: 10, 厘米: 10,
    dm: 100, 分米: 100,
    m: 1000, 米: 1000,
    km: 1000000, 千米: 1000000, 公里: 1000000,
};

function parseNumericLabel(value: string): NumericLabel {
    const text = value.trim().replace(/^−/, '-');
    const sign = text.startsWith('-') ? BigInt(-1) : BigInt(1);
    const unsigned = text.replace(/^[+-]/, '');
    const fraction = unsigned.match(/^(?:(\d+)(?:\s+|又))?(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
        const denominator = BigInt(fraction[3]);
        if (denominator === BigInt(0)) return { kind: 'invalid' };
        const numerator = BigInt(fraction[1] ?? '0') * denominator + BigInt(fraction[2]);
        return { kind: 'number', numerator: sign * numerator, denominator };
    }
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(unsigned)) return { kind: 'unknown' };
    const [whole, decimal = ''] = unsigned.split('.');
    return {
        kind: 'number',
        numerator: sign * BigInt(`${whole || '0'}${decimal}`),
        denominator: BigInt(10) ** BigInt(decimal.length),
    };
}

function parseLengthLabel(value: string | undefined): LengthLabel {
    if (!value || value.length > 80) return { kind: 'unknown' };
    // 只接受完整数值和有限的长度前缀，不从公式、面积或说明中抽取数字。
    const text = value.trim().replace(/^(?:(?:(?:底|上|下)(?:面)?(?:长|宽|高|底)?|边长|棱长|弦长|长度|半径|直径|高度|长|宽|高|底|母线长|母线)(?:为|是)?\s*[:：=＝]?\s*|(?:slant\s+height|radius|diameter|height)\b\s*(?:(?:is|of)\b\s*)?[:：=＝]?\s*|[rdhl]\s*=\s*)/i, '');
    const match = text.match(/^(.*?)\s*(毫米|厘米|分米|千米|公里|米|mm|cm|dm|km|m)?$/i);
    if (!match) return { kind: 'unknown' };
    const number = parseNumericLabel(match[1]);
    if (number.kind !== 'number') return number;
    if (number.numerator <= BigInt(0)) return { kind: 'invalid' };
    const unit = match[2]?.toLowerCase();
    return {
        kind: 'length',
        numerator: number.numerator * BigInt(unit ? UNIT_MILLIMETERS[unit] : 1),
        denominator: number.denominator,
        unit: unit ? 'metric' : 'unitless',
    };
}

function parseFigureLength(measurement: FigureLength): LengthLabel {
    const parsed = parseLengthLabel(measurement.label);
    return parsed.kind === 'length'
        ? { ...parsed, denominator: parsed.denominator * BigInt(measurement.multiple ?? 1) }
        : parsed;
}

/** 只核对结构必然成立的长度关系；换算仅用于比较，不改写标签或补单位。 */
export function validateFigureLengths(measurements: readonly FigureLength[], equal = false): boolean {
    const known = new Map<'metric' | 'unitless', { numerator: bigint; denominator: bigint }>();
    for (const measurement of measurements) {
        const parsed = parseLengthLabel(measurement.label);
        if (parsed.kind === 'invalid') return false;
        if (parsed.kind !== 'length' || !equal) continue;
        // 直径除以 2 后与半径比较；无单位标签只和其它无单位标签比较。
        const value = { numerator: parsed.numerator, denominator: parsed.denominator * BigInt(measurement.multiple ?? 1) };
        const previous = known.get(parsed.unit);
        if (previous && previous.numerator * value.denominator !== value.numerator * previous.denominator) return false;
        known.set(parsed.unit, value);
    }
    return true;
}

/** 完整三边在同一单位类别中均有明确值时，精确核对三角形不等式。 */
export function validateFigureTriangleLengths(sides: readonly (readonly FigureLength[])[]): boolean {
    if (sides.length !== 3 || !sides.every((side) => validateFigureLengths(side, true))) return false;
    const parsed = sides.map((side) => side.map(parseFigureLength));
    for (const unit of ['metric', 'unitless'] as const) {
        const known = parsed.map((side) => side.find((value): value is Extract<LengthLabel, { kind: 'length' }> =>
            value.kind === 'length' && value.unit === unit));
        const [a, b, c] = known;
        if (!a || !b || !c) continue;
        const first = a.numerator * b.denominator * c.denominator;
        const second = b.numerator * a.denominator * c.denominator;
        const third = c.numerator * a.denominator * b.denominator;
        if (first + second <= third || first + third <= second || second + third <= first) return false;
    }
    return true;
}

/** 仅在同一单位类别的三条完整边均有明确值时精确核对勾股关系，不补单位或求未知数。 */
export function validateFigureRightTriangleLengths(
    firstLeg: readonly FigureLength[],
    secondLeg: readonly FigureLength[],
    hypotenuse: readonly FigureLength[],
): boolean {
    const sides = [firstLeg, secondLeg, hypotenuse];
    if (!sides.every((side) => validateFigureLengths(side, true))) return false;
    const parsed = sides.map((side) => side.map(parseFigureLength));
    for (const unit of ['metric', 'unitless'] as const) {
        const known = parsed.map((side) => side.find((value): value is Extract<LengthLabel, { kind: 'length' }> =>
            value.kind === 'length' && value.unit === unit));
        const [a, b, c] = known;
        if (!a || !b || !c) continue;
        const squared = (value: bigint) => value * value;
        const first = squared(a.numerator * b.denominator * c.denominator);
        const second = squared(b.numerator * a.denominator * c.denominator);
        const third = squared(c.numerator * a.denominator * b.denominator);
        if (first + second !== third) return false;
    }
    return true;
}

/** 同圆的弦不超过直径；同一对端点的长度标注一致，不根据示意坐标推算长度。 */
export function validateCircleLengths(circle: CircleLengths): boolean {
    if (!validateFigureLengths([
        ...circle.radii,
        ...circle.diameters.map((item) => ({ label: item.label, multiple: 2 as const })),
    ], true) || !validateFigureLengths(circle.chords)) return false;

    type KnownLength = Extract<LengthLabel, { kind: 'length' }>;
    const diameterBounds = new Map<KnownLength['unit'], KnownLength>();
    for (const measurement of [
        ...circle.radii.map((item) => ({ label: item.label, scale: 2 })),
        ...circle.diameters.map((item) => ({ label: item.label, scale: 1 })),
    ]) {
        const parsed = parseLengthLabel(measurement.label);
        if (parsed.kind === 'length') {
            diameterBounds.set(parsed.unit, { ...parsed, numerator: parsed.numerator * BigInt(measurement.scale) });
        }
    }
    for (const chord of circle.chords) {
        const parsed = parseLengthLabel(chord.label);
        if (parsed.kind !== 'length') continue;
        const diameter = diameterBounds.get(parsed.unit);
        if (diameter && parsed.numerator * diameter.denominator > diameter.numerator * parsed.denominator) return false;
    }

    const segments = new Map<string, FigureLength[]>();
    for (const segment of [...circle.diameters, ...circle.chords]) {
        const key = JSON.stringify([segment.from, segment.to].sort());
        const labels = segments.get(key) ?? [];
        labels.push({ label: segment.label });
        segments.set(key, labels);
    }
    return [...segments.values()].every((labels) => validateFigureLengths(labels, true));
}

/** 只精确比较带度数单位的完整数值；裸数字可能是角编号，未知式不求值。 */
export function validateFigureAngleLabels(labels: readonly { label?: string }[]): boolean {
    let known: Extract<NumericLabel, { kind: 'number' }> | undefined;
    for (const { label } of labels) {
        const match = label?.trim().match(/^(.*?)\s*(?:°|度|degrees?)$/iu);
        if (!match) continue;
        const value = parseNumericLabel(match[1]!);
        if (value.kind === 'invalid') return false;
        if (value.kind !== 'number') continue;
        if (known && known.numerator * value.denominator !== value.numerator * known.denominator) return false;
        known = value;
    }
    return true;
}

/** 裸数字可能是角编号，只有带明确度数单位的数值才与直角标记核对。 */
export function validateRightAngleLabel(label: string | undefined): boolean {
    return validateFigureAngleLabels([{ label }, { label: '90°' }]);
}

export type CircleArcSelection = {
    arcType?: 'minor' | 'major';
    through?: { x: number; y: number };
};

const FULL_TURN = Math.PI * 2;
export const ARC_EPSILON = 0.0001;
const ARC_AMBIGUITY_TOLERANCE = Math.PI / 180;

function normalizeAngleDelta(value: number): number {
    let delta = value;
    while (delta <= -Math.PI) delta += FULL_TURN;
    while (delta > Math.PI) delta -= FULL_TURN;
    return delta;
}

function positiveAngleDelta(value: number): number {
    return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function angleOf(center: { x: number; y: number }, point: { x: number; y: number }): number {
    return Math.atan2(point.y - center.y, point.x - center.x);
}

/** 根据端点、弧型和第三点确定实际绘制的有向弧；方向不明确时返回 null。 */
export function resolveCircleArcDelta(
    center: { x: number; y: number },
    from: { x: number; y: number },
    to: { x: number; y: number },
    selection: CircleArcSelection,
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

/** 判断圆周点是否位于已解析弧段的内部，不把两个端点当作第三点。 */
export function isCirclePointOnArc(
    center: { x: number; y: number },
    from: { x: number; y: number },
    delta: number,
    point: { x: number; y: number },
): boolean {
    const startAngle = angleOf(center, from);
    const pointAngle = angleOf(center, point);
    const travelled = delta >= 0
        ? positiveAngleDelta(pointAngle - startAngle)
        : -positiveAngleDelta(startAngle - pointAngle);
    const size = Math.abs(delta);
    return delta >= 0
        ? travelled > ARC_AMBIGUITY_TOLERANCE && travelled < size - ARC_AMBIGUITY_TOLERANCE
        : travelled < -ARC_AMBIGUITY_TOLERANCE && travelled > delta + ARC_AMBIGUITY_TOLERANCE;
}

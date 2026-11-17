import type { FigureSpec } from './figure-spec';
import { validateFigureLengths, validateFigureTriangleLengths } from './figure-measurements';
import { validateFigureTriangle } from './figure-triangle-consistency';
import type { TriangleQuestionConstraint } from './figure-triangle-consistency';

export type PolygonQuestionShape = 'triangle' | 'rectangle' | 'square' | 'rhombus' | 'parallelogram' | 'trapezoid';
type Geometry = Extract<FigureSpec, { type: 'basic_geometry' }>;
type Point = Geometry['points'][number];
interface Vector { x: number; y: number }

const RELATION_TOLERANCE = 0.02;
const COLLINEAR_TOLERANCE = 1e-8;
const vector = (from: Vector, to: Vector): Vector => ({ x: to.x - from.x, y: to.y - from.y });
const cross = (a: Vector, b: Vector) => a.x * b.y - a.y * b.x;
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y;
const length = (value: Vector) => Math.hypot(value.x, value.y);
const parallel = (a: Vector, b: Vector) => Math.abs(cross(a, b)) <= RELATION_TOLERANCE * length(a) * length(b);
const perpendicular = (a: Vector, b: Vector) => Math.abs(dot(a, b)) <= RELATION_TOLERANCE * length(a) * length(b);

function containsPoint(polygon: readonly Point[], point: Point): boolean {
    let inside = false;
    for (const [index, start] of polygon.entries()) {
        const end = polygon[(index + 1) % polygon.length];
        const edge = vector(start, end);
        const relative = vector(start, point);
        if (Math.abs(cross(edge, relative)) <= COLLINEAR_TOLERANCE * Math.max(1, length(edge))
            && dot(relative, edge) >= -COLLINEAR_TOLERANCE
            && dot(relative, edge) <= dot(edge, edge) + COLLINEAR_TOLERANCE) return true;
        if ((start.y > point.y) !== (end.y > point.y)
            && point.x < start.x + (point.y - start.y) * edge.x / edge.y) inside = !inside;
    }
    return inside;
}

function polygonCorners(polygon: readonly Point[]): Point[] {
    const corners = [...polygon];
    // 仅为检查略过真正共线且沿同一方向的中间点，保存和绘制仍使用完整原始数据。
    while (corners.length > 3) {
        const index = corners.findIndex((point, current) => {
            const incoming = vector(corners[(current + corners.length - 1) % corners.length], point);
            const outgoing = vector(point, corners[(current + 1) % corners.length]);
            return dot(incoming, outgoing) > 0
                && Math.abs(cross(incoming, outgoing)) <= COLLINEAR_TOLERANCE * length(incoming) * length(outgoing);
        });
        if (index < 0) break;
        corners.splice(index, 1);
    }
    return corners;
}

function inferSingleSegmentCycle(spec: Geometry): Point[] | null {
    const solidSegments = spec.segments.filter((segment) => !segment.dashed);
    if (solidSegments.length < 3) return null;

    const adjacency = new Map<string, string[]>();
    const edges = new Set<string>();
    for (const segment of solidSegments) {
        if (segment.from === segment.to) return null;
        const edgeKey = [segment.from, segment.to].sort().join('\u0000');
        if (edges.has(edgeKey)) return null;
        edges.add(edgeKey);
        adjacency.set(segment.from, [...(adjacency.get(segment.from) ?? []), segment.to]);
        adjacency.set(segment.to, [...(adjacency.get(segment.to) ?? []), segment.from]);
    }
    if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) return null;

    const start = adjacency.keys().next().value as string | undefined;
    if (!start) return null;
    const cycle: string[] = [];
    let previous: string | undefined;
    let current = start;
    for (let step = 0; step <= adjacency.size; step += 1) {
        cycle.push(current);
        const neighbors = adjacency.get(current);
        if (!neighbors) return null;
        const next = neighbors.find((id) => id !== previous);
        if (!next) return null;
        previous = current;
        current = next;
        if (current === start) break;
    }
    if (current !== start || cycle.length < 3 || cycle.length !== adjacency.size) return null;

    const points = new Map(spec.points.map((point) => [point.id, point]));
    const boundary = cycle.map((id) => points.get(id));
    return boundary.every((point): point is Point => Boolean(point)) ? boundary : null;
}

function matchesCornerShape(corners: readonly Point[], expected: PolygonQuestionShape): boolean {
    if (expected === 'triangle') return corners.length === 3;
    if (corners.length !== 4) return false;
    const edges = corners.map((point, index) => vector(point, corners[(index + 1) % corners.length]));
    const turns = edges.map((edge, index) => cross(edge, edges[(index + 1) % edges.length]));
    if (!turns.every((turn) => turn > 0) && !turns.every((turn) => turn < 0)) return false;
    const firstParallel = parallel(edges[0], edges[2]);
    const secondParallel = parallel(edges[1], edges[3]);
    // 沿用小学、初中的梯形定义：只有一组对边平行。
    if (expected === 'trapezoid') return firstParallel !== secondParallel;
    if (!firstParallel || !secondParallel) return false;
    if (expected === 'parallelogram') return true;
    if (expected !== 'rhombus'
        && !edges.every((edge, index) => perpendicular(edge, edges[(index + 1) % edges.length]))) return false;
    if (expected === 'rectangle') return true;
    const lengths = edges.map(length);
    return Math.max(...lengths) - Math.min(...lengths) <= RELATION_TOLERANCE * Math.max(...lengths);
}

function matchesSideLabels(spec: Geometry, corners: readonly Point[], expected: PolygonQuestionShape, triangle?: TriangleQuestionConstraint): boolean {
    const labels = corners.map((point, index) => {
        const next = corners[(index + 1) % corners.length];
        // 边上的分段和对角线不当作完整边长，不按坐标比例推算物理长度。
        return spec.segments.filter((segment) => (segment.from === point.id && segment.to === next.id)
            || (segment.to === point.id && segment.from === next.id));
    });
    if (expected === 'triangle') return triangle
        ? validateFigureTriangle(corners, labels, triangle)
        : validateFigureTriangleLengths(labels);
    if (expected === 'square' || expected === 'rhombus') return validateFigureLengths(labels.flat(), true);
    if (expected === 'rectangle' || expected === 'parallelogram') {
        return validateFigureLengths([...labels[0], ...labels[2]], true)
            && validateFigureLengths([...labels[1], ...labels[3]], true);
    }
    return labels.every((side) => validateFigureLengths(side, true));
}

function matchesNamedCorners(corners: readonly Point[], names: readonly string[]): boolean {
    if (corners.length !== names.length) return false;
    const start = corners.findIndex((point) => point.label === names[0]);
    if (start < 0) return false;
    return [1, -1].some((direction) => names.every((name, index) => (
        corners[(start + direction * index + corners.length) % corners.length].label === name
    )));
}

/** 仅核对可明确对应的单个主多边形；复合或外部图元不推断主图归属。 */
export function validateFigurePolygonShape(
    spec: Geometry,
    expected: PolygonQuestionShape,
    triangle?: TriangleQuestionConstraint,
    namedPoints?: readonly string[],
): boolean {
    if (namedPoints) {
        const visibleNames = new Set(spec.points.map((point) => point.label));
        if (namedPoints.some((name) => !visibleNames.has(name))) return false;
    }
    if (spec.circles.length > 0) return true;
    let boundary: Point[];
    if (spec.polygons.length === 0) {
        // 只有所有实线恰好组成一个闭合环时才推断主图；开链、多个环或额外实线继续保守跳过。
        const inferred = inferSingleSegmentCycle(spec);
        if (!inferred) return true;
        boundary = inferred;
    } else {
        if (spec.polygons.length !== 1) return true;
        const points = new Map(spec.points.map((point) => [point.id, point]));
        boundary = [];
        for (const id of spec.polygons[0].points) {
            const point = points.get(id);
            if (!point) return false;
            boundary.push(point);
        }
    }
    if (spec.points.some((point) => !containsPoint(boundary, point))) return true;
    const corners = polygonCorners(boundary);
    return (!namedPoints || matchesNamedCorners(corners, namedPoints))
        && matchesCornerShape(corners, expected) && matchesSideLabels(spec, corners, expected, triangle);
}

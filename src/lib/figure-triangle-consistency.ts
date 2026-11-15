import { validateFigureLengths, validateFigureRightTriangleLengths } from './figure-measurements';

export interface TriangleQuestionConstraint {
    isosceles: boolean;
    equilateral: boolean;
    right: boolean;
}

interface Point { x: number; y: number }
type SideLabels = readonly { label?: string }[];

const TOLERANCE = 0.02;
const equalLength = (first: number, second: number) => Math.abs(first - second) <= TOLERANCE * Math.max(first, second);

/** 只核对声明中的三角形关系；完整边标注与坐标形状分别校验，不改写原始数据。 */
export function validateFigureTriangle(
    points: readonly Point[],
    sides: readonly SideLabels[],
    constraint: TriangleQuestionConstraint,
): boolean {
    if (points.length !== 3 || sides.length !== 3) return false;
    const edges = points.map((point, index) => ({
        x: points[(index + 1) % 3].x - point.x,
        y: points[(index + 1) % 3].y - point.y,
    }));
    const lengths = edges.map((edge) => Math.hypot(edge.x, edge.y));
    if (lengths.some((length) => length <= 0) || !sides.every((side) => validateFigureLengths(side, true))) return false;
    if (constraint.equilateral && (!lengths.every((length) => equalLength(length, Math.max(...lengths)))
        || !validateFigureLengths(sides.flat(), true))) return false;

    // 等腰直角必须是两条直角边相等，不能用细长直角图中近似相等的斜边和长直角边替代。
    if (constraint.right) {
        return edges.some((edge, index) => {
            const previous = (index + 2) % 3;
            const hypotenuse = (index + 1) % 3;
            const perpendicular = Math.abs(edge.x * edges[previous].x + edge.y * edges[previous].y)
                <= TOLERANCE * lengths[index] * lengths[previous];
            return perpendicular
                && (!constraint.isosceles || (equalLength(lengths[index], lengths[previous])
                    && validateFigureLengths([...sides[index], ...sides[previous]], true)))
                && validateFigureRightTriangleLengths(sides[index], sides[previous], sides[hypotenuse]);
        });
    }
    if (constraint.isosceles && !constraint.equilateral) {
        return lengths.some((length, index) => equalLength(length, lengths[(index + 1) % 3])
            && validateFigureLengths([...sides[index], ...sides[(index + 1) % 3]], true));
    }
    return true;
}

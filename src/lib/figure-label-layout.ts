export interface FigurePoint {
    x: number;
    y: number;
}

export interface FigureLabelBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export type FigureLabelObstacle =
    | { type: 'segment'; from: FigurePoint; to: FigurePoint }
    | { type: 'circle'; center: FigurePoint; radius: number; solid?: boolean }
    | { type: 'box'; box: FigureLabelBox };

export interface FigurePointLabel extends FigurePoint {
    width: number;
    height: number;
    preferBelow?: boolean;
}

export interface FigureSegmentLabel {
    from: FigurePoint;
    to: FigurePoint;
    width: number;
    height: number;
    preferredNormal?: FigurePoint;
    maxGap?: number;
}

export interface FigureAngularLabel {
    kind: 'angle' | 'sector' | 'arc';
    center: FigurePoint;
    start: number;
    delta: number;
    innerRadius: number;
    outerRadius: number;
    preferredRadius: number;
    width: number;
    height: number;
}

export interface FigureCircleLabel {
    center: FigurePoint;
    radius: number;
    width: number;
    height: number;
}

/** 仅收紧图元和完整文字框之外的留白，保留描边及字体估算余量。 */
export function getFigureGeometryViewport(obstacles: FigureLabelObstacle[], labels: FigureLabelBox[]): FigureLabelBox | null {
    const boxes = [...labels, ...obstacles.map((obstacle): FigureLabelBox => {
        if (obstacle.type === 'box') return obstacle.box;
        if (obstacle.type === 'circle') return {
            left: obstacle.center.x - obstacle.radius - 2, top: obstacle.center.y - obstacle.radius - 2,
            width: obstacle.radius * 2 + 4, height: obstacle.radius * 2 + 4,
        };
        return {
            left: Math.min(obstacle.from.x, obstacle.to.x) - 2, top: Math.min(obstacle.from.y, obstacle.to.y) - 2,
            width: Math.abs(obstacle.to.x - obstacle.from.x) + 4, height: Math.abs(obstacle.to.y - obstacle.from.y) + 4,
        };
    })];
    if (!boxes.length || boxes.some((box) => ![box.left, box.top, box.width, box.height].every(Number.isFinite)
        || box.width <= 0 || box.height <= 0)) return null;
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    if (left < 0 || top < 0 || right > 800 || bottom > 500) return null;
    const x = Math.max(0, Math.floor(left - 12));
    const y = Math.max(0, Math.floor(top - 12));
    return { left: x, top: y, width: Math.min(800, Math.ceil(right + 12)) - x, height: Math.min(500, Math.ceil(bottom + 12)) - y };
}

function expanded(box: FigureLabelBox, padding: number): FigureLabelBox {
    return { left: box.left - padding, top: box.top - padding, width: box.width + padding * 2, height: box.height + padding * 2 };
}

function boxesOverlap(first: FigureLabelBox, second: FigureLabelBox): boolean {
    return first.left < second.left + second.width && first.left + first.width > second.left
        && first.top < second.top + second.height && first.top + first.height > second.top;
}

function segmentCrossesBox(from: FigurePoint, to: FigurePoint, box: FigureLabelBox): boolean {
    let start = 0;
    let end = 1;
    for (const [origin, delta, lower, upper] of [
        [from.x, to.x - from.x, box.left, box.left + box.width],
        [from.y, to.y - from.y, box.top, box.top + box.height],
    ]) {
        if (Math.abs(delta) < 1e-9) {
            if (origin < lower || origin > upper) return false;
        } else {
            const first = (lower - origin) / delta;
            const second = (upper - origin) / delta;
            start = Math.max(start, Math.min(first, second));
            end = Math.min(end, Math.max(first, second));
            if (start > end) return false;
        }
    }
    return true;
}

function overlapsObstacle(box: FigureLabelBox, obstacle: FigureLabelObstacle): boolean {
    const padded = expanded(box, 3);
    if (obstacle.type === 'box') return boxesOverlap(padded, obstacle.box);
    if (obstacle.type === 'segment') return segmentCrossesBox(obstacle.from, obstacle.to, padded);

    const { center, radius } = obstacle;
    const nearestX = Math.max(padded.left, Math.min(center.x, padded.left + padded.width));
    const nearestY = Math.max(padded.top, Math.min(center.y, padded.top + padded.height));
    const nearest = Math.hypot(nearestX - center.x, nearestY - center.y);
    if (nearest > radius) return false;
    if (obstacle.solid) return true;
    const farthestX = Math.max(Math.abs(padded.left - center.x), Math.abs(padded.left + padded.width - center.x));
    const farthestY = Math.max(Math.abs(padded.top - center.y), Math.abs(padded.top + padded.height - center.y));
    return Math.hypot(farthestX, farthestY) >= radius;
}

function candidatesFor(label: FigurePointLabel): FigureLabelBox[] {
    const { x, y, width, height } = label;
    const positions: FigureLabelBox[] = [];
    for (const gap of [12, 18, 24]) {
        const above = [
            { left: x + gap, top: y - gap - height, width, height },
            { left: x - gap - width, top: y - gap - height, width, height },
        ];
        const below = [
            { left: x + gap, top: y + gap, width, height },
            { left: x - gap - width, top: y + gap, width, height },
        ];
        positions.push(...(label.preferBelow ? [...below, ...above] : [...above, ...below]),
            { left: x - width / 2, top: y - gap - height, width, height },
            { left: x + gap, top: y - height / 2, width, height },
            { left: x - width / 2, top: y + gap, width, height },
            { left: x - gap - width, top: y - height / 2, width, height });
    }
    return positions;
}

function distanceToSegment(point: FigurePoint, from: FigurePoint, to: FigurePoint): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const squaredLength = dx * dx + dy * dy;
    const t = squaredLength ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / squaredLength)) : 0;
    return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

function overlapsSameLine(label: FigureSegmentLabel, from: FigurePoint, to: FigurePoint): boolean {
    const dx = label.to.x - label.from.x;
    const dy = label.to.y - label.from.y;
    const length = Math.hypot(dx, dy);
    const projection = (point: FigurePoint) => ((point.x - label.from.x) * dx + (point.y - label.from.y) * dy) / length;
    return [from, to].every((point) => Math.abs((point.x - label.from.x) * dy - (point.y - label.from.y) * dx) / length < 0.01)
        && Math.max(projection(from), projection(to)) >= 0 && Math.min(projection(from), projection(to)) <= length;
}

function segmentCandidates(label: FigureSegmentLabel, obstacles: FigureLabelObstacle[]): FigureLabelBox[] {
    const { from, to, width, height } = label;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1) return [];
    const tangent = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    let normal = { x: -tangent.y, y: tangent.x };
    const preferred = label.preferredNormal ?? { x: 1e-3, y: -1 };
    if (normal.x * preferred.x + normal.y * preferred.y < 0) normal = { x: -normal.x, y: -normal.y };
    const normalExtent = (Math.abs(normal.x) * width + Math.abs(normal.y) * height) / 2;
    const tangentExtent = (Math.abs(tangent.x) * width + Math.abs(tangent.y) * height) / 2;
    const otherSegments = obstacles.filter((obstacle) => obstacle.type === 'segment' && !overlapsSameLine(label, obstacle.from, obstacle.to));
    const positions: FigureLabelBox[] = [];
    // 仅在线段中部的有限位置选位；文字框沿切线方向也不能越过端点。
    for (const gap of [8, 14, 22, 34, 48]) {
        if (gap > (label.maxGap ?? 48)) continue;
        for (const t of [0.5, 0.35, 0.65]) {
            if (Math.min(t, 1 - t) * length < tangentExtent) continue;
            for (const side of [1, -1]) {
                const center = {
                    x: from.x + tangent.x * length * t + normal.x * (normalExtent + gap) * side,
                    y: from.y + tangent.y * length * t + normal.y * (normalExtent + gap) * side,
                };
                const ownDistance = distanceToSegment(center, from, to);
                if (otherSegments.some((obstacle) => obstacle.type === 'segment'
                    && distanceToSegment(center, obstacle.from, obstacle.to) < ownDistance + 2)) continue;
                positions.push({ left: center.x - width / 2, top: center.y - height / 2, width, height });
            }
        }
    }
    return positions;
}

export function boxFitsAngularRegion(box: FigureLabelBox, region: FigureAngularLabel): boolean {
    const { center, start, delta, innerRadius, outerRadius } = region;
    if (![center.x, center.y, start, delta, innerRadius, outerRadius].every(Number.isFinite)
        || Math.abs(delta) < 1e-6 || Math.abs(delta) >= Math.PI * 2 || innerRadius < 0 || outerRadius <= innerRadius) return false;
    const corners = [box.left, box.left + box.width].flatMap((x) => [box.top, box.top + box.height].map((y) => ({ x, y })));
    const nearest = { x: Math.max(box.left, Math.min(center.x, box.left + box.width)), y: Math.max(box.top, Math.min(center.y, box.top + box.height)) };
    if (Math.hypot(nearest.x - center.x, nearest.y - center.y) < innerRadius) return false;
    if (!corners.every((point) => {
        const angle = (Math.atan2(point.y - center.y, point.x - center.x) - start) * Math.sign(delta);
        const along = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return Math.hypot(point.x - center.x, point.y - center.y) <= outerRadius
            && (along <= Math.abs(delta) + 1e-9 || Math.PI * 2 - along < 1e-9);
    })) return false;
    // 优弧区域非凸，仅检查四角不足以排除文字框穿过被排除的小扇形。
    return [start, start + delta].every((angle) => !segmentCrossesBox(center, {
        x: center.x + Math.cos(angle) * outerRadius,
        y: center.y + Math.sin(angle) * outerRadius,
    }, box));
}

function angularCandidates(label: FigureAngularLabel): FigureLabelBox[] {
    const { center, start, delta, innerRadius, outerRadius, preferredRadius, width, height } = label;
    const positions: FigureLabelBox[] = [];
    const radii = [Math.max(innerRadius, Math.min(outerRadius, preferredRadius)), ...[0.5, 0.4, 0.65, 0.25, 0.85].map((ratio) => innerRadius + (outerRadius - innerRadius) * ratio)];
    for (const radius of radii) {
        for (const ratio of [0.5, 0.4, 0.6, 0.3, 0.7]) {
            const angle = start + delta * ratio;
            const box = { left: center.x + Math.cos(angle) * radius - width / 2, top: center.y + Math.sin(angle) * radius - height / 2, width, height };
            if (boxFitsAngularRegion(expanded(box, 3), label)) positions.push(box);
        }
    }
    return positions;
}

function circleCandidates(label: FigureCircleLabel, obstacles: FigureLabelObstacle[]): FigureLabelBox[] {
    const { center, radius, width, height } = label;
    const positions: FigureLabelBox[] = [];
    const halfWidth = width / 2 + 3;
    const halfHeight = height / 2 + 3;
    const remaining = radius * radius - halfWidth * halfWidth - halfHeight * halfHeight;
    if (remaining <= 0) return positions;
    const angles = [-Math.PI / 2, 0, Math.PI, Math.PI / 2, -Math.PI / 4, -Math.PI * 0.75, Math.PI / 4, Math.PI * 0.75];
    // 小圆的圆名应优先放在圆心；只有圆内确实有空间时才移到圆周附近。
    for (const distance of [0, 24, 36, 48, 64, radius * 0.5, radius * 0.65, radius * 0.8]) {
        for (const angle of angles) addCandidate(angle, distance);
    }
    // 按文字框四角求靠近圆周的最远候选，避免固定间隔漏掉狭窄但足够的圆环空间。
    for (const angle of angles) {
        const projection = Math.abs(Math.cos(angle)) * halfWidth + Math.abs(Math.sin(angle)) * halfHeight;
        addCandidate(angle, Math.sqrt(projection * projection + remaining) - projection - 0.5);
    }
    return positions;

    function addCandidate(angle: number, distance: number) {
        if (distance < 0) return;
        const box = { left: center.x + Math.cos(angle) * distance - width / 2, top: center.y + Math.sin(angle) * distance - height / 2, width, height };
        const padded = expanded(box, 3);
        const corners = [padded.left, padded.left + padded.width].flatMap((x) => [padded.top, padded.top + padded.height].map((y) => ({ x, y })));
        if (!corners.every((point) => Math.hypot(point.x - center.x, point.y - center.y) < radius)) return;
        // 包含所属圆的外圆不构成歧义；其它圆的内部不能用来安放本圆圆名。
        if (obstacles.some((obstacle) => {
            if (obstacle.type !== 'circle' || obstacle.solid
                || Math.hypot(obstacle.center.x - center.x, obstacle.center.y - center.y) + radius <= obstacle.radius + 0.01) return false;
            const x = Math.max(padded.left, Math.min(obstacle.center.x, padded.left + padded.width));
            const y = Math.max(padded.top, Math.min(obstacle.center.y, padded.top + padded.height));
            return Math.hypot(x - obstacle.center.x, y - obstacle.center.y) <= obstacle.radius;
        })) return;
        positions.push(box);
    }
}

/** 固定图元不移动；各类标注共同选位，搜索到上限后明确回退。 */
export function layoutFigureGeometryLabels(
    labels: FigurePointLabel[],
    segmentLabels: FigureSegmentLabel[],
    obstacles: FigureLabelObstacle[],
    angularLabels: FigureAngularLabel[] = [],
    bounds: FigureLabelBox = { left: 8, top: 8, width: 784, height: 484 },
    anchored: { fixed?: FigureLabelBox[]; circles?: FigureCircleLabel[] } = {},
): { points: FigureLabelBox[]; segments: FigureLabelBox[]; angular: FigureLabelBox[]; circles: FigureLabelBox[] } | null {
    const fixed = anchored.fixed ?? [];
    const circles = anchored.circles ?? [];
    const inside = (box: FigureLabelBox, area: FigureLabelBox) =>
        [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0
        && box.left >= area.left && box.top >= area.top
        && box.left + box.width <= area.left + area.width
        && box.top + box.height <= area.top + area.height;
    // 固定文字的预估字形保留四像素边距；其它可移动标注继续使用原有八像素边距。
    if (fixed.some((box, index) => !inside(box, expanded(bounds, 4))
        || obstacles.some((obstacle) => overlapsObstacle(box, obstacle))
        || fixed.slice(index + 1).some((other) => boxesOverlap(expanded(box, 3), other)))) return null;
    const allObstacles: FigureLabelObstacle[] = [...obstacles, ...fixed.map((box): FigureLabelObstacle => ({ type: 'box', box }))];
    const points = [...labels, ...obstacles.flatMap((obstacle) => obstacle.type === 'circle' && obstacle.solid ? [obstacle.center] : [])];
    const isAvailable = (box: FigureLabelBox) =>
        inside(box, bounds) && !allObstacles.some((obstacle) => overlapsObstacle(box, obstacle));
    const isCircleLabelAvailable = (label: FigureCircleLabel, box: FigureLabelBox) =>
        inside(box, bounds) && !allObstacles.some((obstacle) => {
            // 圆名可以覆盖所属圆心的点标记；其它实心点仍是有效障碍。
            if (obstacle.type === 'circle' && obstacle.solid
                && Math.hypot(obstacle.center.x - label.center.x, obstacle.center.y - label.center.y) < 0.01) return false;
            return overlapsObstacle(box, obstacle);
        });
    const candidates = labels.map((label) => candidatesFor(label).filter((box) => isAvailable(box) && points.every((point) => {
        const separation = Math.hypot(point.x - label.x, point.y - label.y);
        if (separation < 1e-6) return true;
        const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        // 留出实际字体的估算余量，避免点名更靠近旁边的点而产生归属歧义。
        return Math.hypot(center.x - point.x, center.y - point.y)
            >= Math.hypot(center.x - label.x, center.y - label.y) + Math.min(4, separation * 0.2);
    })));
    candidates.push(...segmentLabels.map((label) => segmentCandidates(label, obstacles).filter(isAvailable)));
    candidates.push(...angularLabels.map((label) => angularCandidates(label).filter(isAvailable)));
    candidates.push(...circles.map((label) => circleCandidates(label, obstacles).filter((box) => isCircleLabelAvailable(label, box))));
    if (candidates.some((positions) => positions.length === 0)) return null;
    const placed = new Map<number, FigureLabelBox>();
    let attempts = 0;
    const search = (): boolean => {
        if (placed.size === candidates.length) return true;
        if (attempts >= 4096) return false;
        let next = -1;
        let available: FigureLabelBox[] = [];
        const occupied = Array.from(placed.values());
        // 优先安排可选位置少的标注，避免占掉其它标注唯一可用的位置。
        for (const [index, positions] of candidates.entries()) {
            if (placed.has(index)) continue;
            const choices = positions.filter((box) => !occupied.some((other) => boxesOverlap(expanded(box, 3), other)));
            if (choices.length === 0) return false;
            if (next === -1 || choices.length < available.length) {
                next = index;
                available = choices;
            }
        }
        for (const box of available) {
            if (attempts++ >= 4096) break;
            placed.set(next, box);
            if (search()) return true;
            placed.delete(next);
        }
        return false;
    };
    return search() ? {
        points: labels.map((_, index) => placed.get(index)!),
        segments: segmentLabels.map((_, index) => placed.get(labels.length + index)!),
        angular: angularLabels.map((_, index) => placed.get(labels.length + segmentLabels.length + index)!),
        circles: circles.map((_, index) => placed.get(labels.length + segmentLabels.length + angularLabels.length + index)!),
    } : null;
}

export function layoutFigurePointLabels(
    labels: FigurePointLabel[],
    obstacles: FigureLabelObstacle[],
    bounds?: FigureLabelBox,
): FigureLabelBox[] | null {
    return layoutFigureGeometryLabels(labels, [], obstacles, [], bounds)?.points ?? null;
}

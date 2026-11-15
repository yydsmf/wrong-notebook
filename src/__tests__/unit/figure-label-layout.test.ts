import { describe, expect, it } from 'vitest';
import { boxFitsAngularRegion, getFigureGeometryViewport, layoutFigureGeometryLabels, layoutFigurePointLabels } from '@/lib/figure-label-layout';
import type { FigureAngularLabel, FigureCircleLabel, FigureLabelBox, FigureLabelObstacle, FigureSegmentLabel } from '@/lib/figure-label-layout';

describe('几何图有效画布', () => {
    it('按完整图元和文字框收紧留白，保留描边及字体余量', () => {
        const obstacles: FigureLabelObstacle[] = [
            { type: 'segment', from: { x: 300, y: 200 }, to: { x: 500, y: 350 } },
            { type: 'circle', center: { x: 400, y: 250 }, radius: 80 },
        ];
        const labels = [{ left: 270, top: 170, width: 60, height: 32 }, { left: 510, top: 340, width: 45, height: 30 }];
        const original = structuredClone({ obstacles, labels });
        expect(getFigureGeometryViewport(obstacles, labels)).toEqual({ left: 258, top: 156, width: 309, height: 226 });
        expect({ obstacles, labels }).toEqual(original);
        expect(getFigureGeometryViewport([...obstacles].reverse(), [...labels].reverse())).toEqual(getFigureGeometryViewport(obstacles, labels));
    });

    it('水平、竖直和单点图元也保留非零的画布尺寸', () => {
        for (const to of [{ x: 500, y: 250 }, { x: 400, y: 400 }, { x: 400, y: 250 }]) {
            const box = getFigureGeometryViewport([{ type: 'segment', from: { x: 400, y: 250 }, to }], []);
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(28);
            expect(box!.height).toBeGreaterThanOrEqual(28);
        }
    });

    it('边缘留白不超出原画布，并保留全部有效内容', () => {
        expect(getFigureGeometryViewport([], [{ left: 4, top: 4, width: 792, height: 492 }])).toEqual({ left: 0, top: 0, width: 800, height: 500 });
        expect(getFigureGeometryViewport([{ type: 'box', box: { left: 100, top: 100, width: 80, height: 40 } }], [])).toEqual({ left: 88, top: 88, width: 104, height: 64 });
    });

    it.each([
        { left: -1, top: 10, width: 20, height: 20 }, { left: 790, top: 10, width: 20, height: 20 },
        { left: 10, top: 490, width: 20, height: 20 }, { left: 10, top: 10, width: 0, height: 20 },
        { left: Number.NaN, top: 10, width: 20, height: 20 },
    ])('无效边界不靠裁掉内容来适应画布', (box) => {
        expect(getFigureGeometryViewport([], [box])).toBeNull();
    });

    it('空图不返回伪造的有效范围', () => {
        expect(getFigureGeometryViewport([], [])).toBeNull();
    });
});

describe('固定说明与圆名', () => {
    const center = { x: 400, y: 250 };
    const circle: FigureCircleLabel = { center, radius: 120, width: 36, height: 29 };
    const ring: FigureLabelObstacle = { type: 'circle', center, radius: 120 };

    it.each<FigureLabelObstacle>([
        { type: 'segment', from: { x: 200, y: 250 }, to: { x: 600, y: 250 } },
        { type: 'circle', center, radius: 5, solid: true },
        { type: 'circle', center: { x: 380, y: 250 }, radius: 20 },
    ])('固定文字遮挡图元时回退，不能悄悄移到其它位置', (obstacle) => {
        const fixed = [{ left: 380, top: 235, width: 40, height: 30 }];
        const snapshot = structuredClone(fixed);
        expect(layoutFigureGeometryLabels([], [], [obstacle], [], undefined, { fixed })).toBeNull();
        expect(fixed).toEqual(snapshot);
    });

    it('固定说明互相重叠或越界时回退，空白处的有效说明保留', () => {
        const fixed = [{ left: 300, top: 100, width: 80, height: 30 }];
        expect(layoutFigureGeometryLabels([], [], [], [], undefined, { fixed })).not.toBeNull();
        expect(layoutFigureGeometryLabels([], [], [], [], undefined, { fixed: [...fixed, { ...fixed[0], left: 320 }] })).toBeNull();
        expect(layoutFigureGeometryLabels([], [], [], [], undefined, { fixed: [{ ...fixed[0], left: -1 }] })).toBeNull();
    });

    it('圆名绕过斜线、中心点与固定说明，但整个文字框仍在所属圆内', () => {
        const fixed: FigureLabelBox[] = [{ left: 370, top: 175, width: 60, height: 30 }];
        const result = layoutFigureGeometryLabels([], [], [ring,
            { type: 'circle', center, radius: 4, solid: true },
            { type: 'segment', from: { x: 280, y: 130 }, to: { x: 520, y: 370 } },
        ], [], undefined, { fixed, circles: [circle] });
        expect(result).not.toBeNull();
        const box = result!.circles[0];
        for (const x of [box.left, box.left + box.width]) {
            for (const y of [box.top, box.top + box.height]) expect(Math.hypot(x - center.x, y - center.y)).toBeLessThan(circle.radius);
        }
        expect(box.left > fixed[0].left + fixed[0].width || box.left + box.width < fixed[0].left
            || box.top > fixed[0].top + fixed[0].height || box.top + box.height < fixed[0].top).toBe(true);
        expect(box.left > center.x + 4 || box.left + box.width < center.x - 4
            || box.top > center.y + 4 || box.top + box.height < center.y - 4).toBe(true);
    });

    it.each([{ x: 400, y: 250, radius: 70 }, { x: 455, y: 250, radius: 120 }, { x: 455, y: 250, radius: 130 }])('圆名不会躲进另一个圆的内部 $radius', (other) => {
        const result = layoutFigureGeometryLabels([], [], [ring, { type: 'circle', center: other, radius: other.radius }], [], undefined, { circles: [circle] });
        expect(result).not.toBeNull();
        const box = result!.circles[0];
        const nearestX = Math.max(box.left, Math.min(other.x, box.left + box.width));
        const nearestY = Math.max(box.top, Math.min(other.y, box.top + box.height));
        expect(Math.hypot(nearestX - other.x, nearestY - other.y)).toBeGreaterThan(other.radius);
    });

    it('同心圆的两个圆名可同时排版，外圆名称留在圆环内', () => {
        const outer = { ...circle, radius: 180 };
        const result = layoutFigureGeometryLabels([], [], [ring, { ...ring, radius: 180 }], [], undefined, { circles: [circle, outer] });
        expect(result).not.toBeNull();
        const innerName = result!.circles[0];
        const outerName = result!.circles[1];
        expect(Math.hypot(innerName.left + innerName.width / 2 - center.x, innerName.top + innerName.height / 2 - center.y)).toBeLessThan(120);
        const nearestX = Math.max(outerName.left, Math.min(center.x, outerName.left + outerName.width));
        const nearestY = Math.max(outerName.top, Math.min(center.y, outerName.top + outerName.height));
        expect(Math.hypot(nearestX - center.x, nearestY - center.y)).toBeGreaterThan(120);
    });

    it('圆太小或内部没有可靠空位时回退，不把圆名扔到圆外', () => {
        expect(layoutFigureGeometryLabels([], [], [], [], undefined, { circles: [{ ...circle, radius: 10 }] })).toBeNull();
        expect(layoutFigureGeometryLabels([], [], [ring, { type: 'box', box: { left: 270, top: 120, width: 260, height: 260 } }], [], undefined, { circles: [circle] })).toBeNull();
        expect(layoutFigureGeometryLabels([], [], [ring, { type: 'circle', center: { x: 455, y: 250 }, radius: 145 }], [], undefined, { circles: [circle] })).toBeNull();
    });
});

describe('几何点名避让', () => {
    it('点名不占用整条斜线所在的一侧', () => {
        const result = layoutFigurePointLabels([{ x: 200, y: 200, width: 40, height: 32 }], [
            { type: 'segment', from: { x: 200, y: 200 }, to: { x: 600, y: -200 } },
        ]);
        expect(result).not.toBeNull();
        // 旧实现固定放在右上方，此处斜线从点沿右上方向穿过该区域。
        expect(result![0].left < 200 || result![0].top > 200).toBe(true);
    });

    it('圆周上的点名完整留在圆内或圆外，不压住圆周', () => {
        const result = layoutFigurePointLabels([{ x: 300, y: 200, width: 60, height: 32 }], [
            { type: 'circle', center: { x: 200, y: 200 }, radius: 100 },
        ]);
        expect(result).not.toBeNull();
        expect(result![0].left).toBeGreaterThan(300);
    });

    it('画布右边界点名向内排版并保留完整宽度', () => {
        const result = layoutFigurePointLabels([{ x: 710, y: 250, width: 72, height: 28.8 }], []);
        expect(result).not.toBeNull();
        expect(result![0].left + result![0].width).toBeLessThan(710);
        expect(result![0].width).toBe(72);
    });

    it('预留文字占住右上位置时选择其它空位', () => {
        const result = layoutFigurePointLabels([{ x: 200, y: 200, width: 30, height: 32 }], [
            { type: 'box', box: { left: 210, top: 150, width: 80, height: 45 } },
        ]);
        expect(result).not.toBeNull();
        expect(result![0].left < 200 || result![0].top > 200).toBe(true);
    });

    it('点名中心不比所属点更靠近相邻点，避免密集点对应错位', () => {
        const points = [{ x: 200, y: 200, width: 40, height: 32 }, { x: 220, y: 200, width: 40, height: 32 }];
        const result = layoutFigurePointLabels(points, []);
        expect(result).not.toBeNull();
        for (const [index, box] of result!.entries()) {
            const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            const own = points[index];
            const other = points[1 - index];
            expect(Math.hypot(center.x - own.x, center.y - own.y)).toBeLessThan(Math.hypot(center.x - other.x, center.y - other.y));
        }
    });

    it('多个相邻点名保持独立且不改变输入坐标', () => {
        const points = [{ x: 400, y: 250, width: 40, height: 32 }, { x: 402, y: 250, width: 40, height: 32 }, { x: 401, y: 254, width: 40, height: 32 }];
        const original = structuredClone(points);
        const obstacles: FigureLabelObstacle[] = points.map((point) => ({ type: 'circle', center: point, radius: 4, solid: true }));
        const result = layoutFigurePointLabels(points, obstacles);
        expect(result).toHaveLength(3);
        for (const [index, box] of result!.entries()) {
            for (const other of result!.slice(index + 1)) {
                expect(box.left + box.width <= other.left || other.left + other.width <= box.left
                    || box.top + box.height <= other.top || other.top + other.height <= box.top).toBe(true);
            }
        }
        expect(points).toEqual(original);
        expect(layoutFigurePointLabels(points, obstacles)).toEqual(result);
    });

    it('全部可用位置被占用时明确回退', () => {
        expect(layoutFigurePointLabels([{ x: 400, y: 250, width: 40, height: 32 }], [
            { type: 'box', box: { left: 0, top: 0, width: 800, height: 500 } },
        ])).toBeNull();
    });

    it('大量点名争用同一小片区域时结束搜索并回退', () => {
        expect(layoutFigurePointLabels(Array.from({ length: 30 }, () => ({ x: 400, y: 250, width: 40, height: 32 })), [])).toBeNull();
    });

    it('没有点名时仍可绘制原图', () => {
        expect(layoutFigurePointLabels([], [])).toEqual([]);
    });
});

describe('长度标注避让', () => {
    it.each([
        { x: 600, y: 200 }, { x: 200, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 50 },
        { x: 205, y: 400 }, { x: 600, y: 205 },
    ])('沿 $x,$y 方向的标注整个文字框与线段保持距离', (to) => {
        const from = { x: 200, y: 200 };
        const label = { from, to, width: 100, height: 32 };
        const obstacles: FigureLabelObstacle[] = [{ type: 'segment', from, to }];
        const result = layoutFigureGeometryLabels([], [label], obstacles);
        expect(result).not.toBeNull();
        const box = result!.segments[0];
        for (let index = 0; index <= 1000; index += 1) {
            const x = from.x + (to.x - from.x) * index / 1000;
            const y = from.y + (to.y - from.y) * index / 1000;
            expect(x < box.left - 3 || x > box.left + box.width + 3
                || y < box.top - 3 || y > box.top + box.height + 3).toBe(true);
        }
        // 端点顺序改变不改变标注的默认侧向和位置。
        expect(layoutFigureGeometryLabels([], [{ ...label, from: to, to: from }], obstacles)).toEqual(result);
    });

    it('线段两侧存在其它线段时仍保持长度标注归属', () => {
        const labels: FigureSegmentLabel[] = [200, 245].map((y) => ({ from: { x: 200, y }, to: { x: 600, y }, width: 80, height: 32 }));
        const obstacles: FigureLabelObstacle[] = labels.map(({ from, to }) => ({ type: 'segment', from, to }));
        const result = layoutFigureGeometryLabels([], labels, obstacles);
        expect(result).not.toBeNull();
        for (const [index, box] of result!.segments.entries()) {
            const y = box.top + box.height / 2;
            expect(Math.abs(y - labels[index].from.y)).toBeLessThan(Math.abs(y - labels[1 - index].from.y));
        }
    });

    it('中点被文字占用时仅沿线段中部调整并保留输入数据', () => {
        const label = { from: { x: 200, y: 200 }, to: { x: 600, y: 200 }, width: 60, height: 32 };
        const original = structuredClone(label);
        const obstacles: FigureLabelObstacle[] = [
            { type: 'segment', from: label.from, to: label.to },
            { type: 'box', box: { left: 380, top: 0, width: 40, height: 500 } },
        ];
        const result = layoutFigureGeometryLabels([], [label], obstacles);
        expect(result).not.toBeNull();
        const box = result!.segments[0];
        expect(box.left + box.width <= 377 || box.left >= 423).toBe(true);
        expect((box.left + box.width / 2 - 200) / 400).toBeGreaterThanOrEqual(0.35);
        expect((box.left + box.width / 2 - 200) / 400).toBeLessThanOrEqual(0.65);
        expect(label).toEqual(original);
        expect(layoutFigureGeometryLabels([], [label], obstacles)).toEqual(result);
    });

    it('点名和长度标注共同排版，互不重叠', () => {
        const from = { x: 200, y: 200 };
        const to = { x: 600, y: 200 };
        const result = layoutFigureGeometryLabels([{ x: 400, y: 200, width: 30, height: 32 }], [{ from, to, width: 80, height: 32 }], [
            { type: 'segment', from, to }, { type: 'circle', center: { x: 400, y: 200 }, radius: 4, solid: true },
        ]);
        expect(result).not.toBeNull();
        const first = result!.points[0];
        const second = result!.segments[0];
        expect(first.left + first.width <= second.left || second.left + second.width <= first.left
            || first.top + first.height <= second.top || second.top + second.height <= first.top).toBe(true);
    });

    it('上方无空位时切换到下方，不覆盖固定说明', () => {
        const from = { x: 200, y: 200 };
        const to = { x: 600, y: 200 };
        const result = layoutFigureGeometryLabels([], [{ from, to, width: 80, height: 32 }], [
            { type: 'segment', from, to }, { type: 'box', box: { left: 0, top: 0, width: 800, height: 200 } },
        ]);
        expect(result!.segments[0].top).toBeGreaterThan(200);
    });

    it.each([
        { from: { x: 200, y: 200 }, to: { x: 210, y: 200 }, width: 80, height: 32 },
        { from: { x: 200, y: 200 }, to: { x: 200, y: 200 }, width: 80, height: 32 },
    ])('无法在线段中部完整放下标注时明确回退', (label) => {
        expect(layoutFigureGeometryLabels([], [label], [])).toBeNull();
    });

    it('大量长度标注争用同一小片区域时结束搜索并回退', () => {
        const label = { from: { x: 200, y: 200 }, to: { x: 600, y: 200 }, width: 80, height: 32 };
        expect(layoutFigureGeometryLabels([], Array.from({ length: 30 }, () => label), [{ type: 'segment', from: label.from, to: label.to }])).toBeNull();
    });

    it('半径标注的有限间隔放不下时回退，不拉远文字迁就其它标注', () => {
        const label = { from: { x: 400, y: 250 }, to: { x: 517, y: 250 }, width: 36, height: 28.8 };
        const obstacles: FigureLabelObstacle[] = [{ type: 'segment', from: label.from, to: label.to }, { type: 'box', box: { left: 200, top: 220, width: 500, height: 60 } }];
        expect(layoutFigureGeometryLabels([], [{ ...label, maxGap: 14 }], obstacles)).toBeNull();
        expect(layoutFigureGeometryLabels([], [label], obstacles)).not.toBeNull();
    });
});

describe('角度和扇形标注避让', () => {
    const base: FigureAngularLabel = {
        kind: 'sector', center: { x: 400, y: 250 }, start: 0, delta: Math.PI / 2,
        innerRadius: 0, outerRadius: 150, preferredRadius: 80, width: 36, height: 29,
    };

    it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])('顺时针方向 %s 的完整文字框保留在所属象限', (start) => {
        const label = { ...base, start };
        const result = layoutFigureGeometryLabels([], [], [], [label]);
        expect(result).not.toBeNull();
        const box = result!.angular[0];
        for (const x of [box.left, box.left + box.width]) {
            for (const y of [box.top, box.top + box.height]) {
                const along = (Math.atan2(y - 250, x - 400) - start + Math.PI * 2) % (Math.PI * 2);
                expect(along).toBeGreaterThanOrEqual(0);
                expect(along).toBeLessThanOrEqual(Math.PI / 2);
                expect(Math.hypot(x - 400, y - 250)).toBeLessThan(150);
            }
        }
    });

    it('逆时针且跨越零角度的扇形文字保留在第一象限', () => {
        const result = layoutFigureGeometryLabels([], [], [], [{ ...base, start: Math.PI / 2, delta: -Math.PI / 2 }]);
        expect(result).not.toBeNull();
        expect(result!.angular[0].left).toBeGreaterThan(400);
        expect(result!.angular[0].top).toBeGreaterThan(250);
    });

    it('圆弧标注整个文字框位于圆外，角度标注位于标记外侧', () => {
        const label = { ...base, kind: 'arc' as const, innerRadius: 100, outerRadius: 220, preferredRadius: 150 };
        const result = layoutFigureGeometryLabels([], [], [{ type: 'circle', center: base.center, radius: 100 }], [label]);
        expect(result).not.toBeNull();
        const box = result!.angular[0];
        expect(Math.hypot(box.left - 400, box.top - 250)).toBeGreaterThan(100);
    });

    it('优弧文字框四角合法但中间穿过排除的劣扇形时拒绝', () => {
        const label = { ...base, center: { x: 0, y: 0 }, start: 0.1, delta: Math.PI * 2 - 0.2, outerRadius: 100 };
        const box = { left: 10, top: -5, width: 20, height: 10 };
        // 四角均在优弧区域，文字框中心却位于被排除的正东方向。
        expect([box.left, box.left + box.width].every((x) => [box.top, box.top + box.height].every((y) => Math.abs(Math.atan2(y, x)) > 0.1))).toBe(true);
        expect(boxFitsAngularRegion(box, label)).toBe(false);
        expect(boxFitsAngularRegion({ left: -30, top: -5, width: 20, height: 10 }, label)).toBe(true);
    });

    it('四角在内圆之外但整个文字框覆盖圆心时拒绝', () => {
        expect(boxFitsAngularRegion({ left: 380, top: 230, width: 40, height: 40 }, { ...base, delta: Math.PI * 1.5, innerRadius: 10 })).toBe(false);
    });

    it('角平分线被弦穿过时在同一扇形内选择空位', () => {
        const label = { ...base, start: -Math.PI / 2 };
        const result = layoutFigureGeometryLabels([], [], [{ type: 'segment', from: { x: 400, y: 100 }, to: { x: 550, y: 250 } }], [label]);
        expect(result).not.toBeNull();
        const box = result!.angular[0];
        for (let index = 0; index <= 1000; index += 1) {
            const x = 400 + 150 * index / 1000;
            const y = 100 + 150 * index / 1000;
            expect(x < box.left - 3 || x > box.left + box.width + 3 || y < box.top - 3 || y > box.top + box.height + 3).toBe(true);
        }
        expect(box.left).toBeGreaterThan(400);
        expect(box.top + box.height).toBeLessThan(250);
    });

    it('多个扇形标注、点名和长度标注一起排版且不改变输入', () => {
        const labels = [base, { ...base, start: Math.PI / 2 }, { ...base, kind: 'arc' as const, innerRadius: 160, outerRadius: 240, preferredRadius: 200 }];
        const original = structuredClone(labels);
        const segment = { from: base.center, to: { x: 550, y: 250 }, width: 30, height: 29 };
        const obstacles: FigureLabelObstacle[] = [{ type: 'circle', center: base.center, radius: 150 }, { type: 'circle', center: base.center, radius: 4, solid: true }, { type: 'segment', from: segment.from, to: segment.to }];
        const point = { ...base.center, width: 16, height: 32 };
        const result = layoutFigureGeometryLabels([point], [segment], obstacles, labels);
        expect(result).not.toBeNull();
        const boxes = [...result!.points, ...result!.segments, ...result!.angular];
        for (const [index, box] of boxes.entries()) {
            for (const other of boxes.slice(index + 1)) {
                expect(box.left + box.width <= other.left || other.left + other.width <= box.left
                    || box.top + box.height <= other.top || other.top + other.height <= box.top).toBe(true);
            }
        }
        expect(labels).toEqual(original);
        expect(layoutFigureGeometryLabels([point], [segment], obstacles, labels)).toEqual(result);
    });

    it.each([
        { ...base, delta: 0.03, width: 100 },
        { ...base, outerRadius: 5 },
        { ...base, innerRadius: 160 },
        { ...base, delta: 0 },
        { ...base, delta: Number.NaN },
    ])('空间不足或区域无效时明确回退', (label) => {
        expect(layoutFigureGeometryLabels([], [], [], [label])).toBeNull();
    });

    it('所有位置被固定说明占用时不把扇形文字移到其它象限', () => {
        expect(layoutFigureGeometryLabels([], [], [{ type: 'box', box: { left: 400, top: 250, width: 160, height: 160 } }], [base])).toBeNull();
    });
});

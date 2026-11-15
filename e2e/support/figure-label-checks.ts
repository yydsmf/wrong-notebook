/** 使用浏览器实际字形和图元路径核对标注，独立于服务端的文字宽度估算。 */
export async function inspectFigureLabels({ markup, labels }: { markup: string; labels?: string[] }): Promise<string[]> {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
    host.append(svg);
    document.body.append(host);
    try {
        await document.fonts.ready;
        const issues: string[] = [];
        const texts = Array.from(svg.querySelectorAll('text'));
        const managedLabels = labels
            ? texts.filter((element) => labels.includes(element.textContent ?? ''))
            : texts.filter((element) => ['point', 'segment', 'angle', 'sector', 'arc', 'fixed', 'circle'].includes(element.getAttribute('data-figure-label') ?? ''));
        const shapes = Array.from(svg.querySelectorAll<SVGGeometryElement>('line, path, circle, polygon, polyline')).filter((element) => {
            const stroke = element.getAttribute('stroke');
            // 浅灰坐标网格是背景；坐标轴、题目线条和各色点标记都参与检查。
            const fill = element.getAttribute('fill');
            return (stroke && stroke !== 'none' && stroke !== '#e5e7eb')
                || (element.tagName === 'circle' && Number(element.getAttribute('r')) <= 7 && fill && fill !== 'none' && fill !== '#fff');
        });
        const markers = Array.from(svg.querySelectorAll('circle')).filter((element) => {
            const fill = element.getAttribute('fill');
            return Number(element.getAttribute('r')) <= 7 && fill && fill !== 'none' && fill !== '#fff';
        });
        const segments = Array.from(svg.querySelectorAll('line')).filter((element) => element.getAttribute('stroke') !== '#e5e7eb');
        for (const label of managedLabels) {
            const box = label.getBBox();
            if (label.getAttribute('data-figure-label') === 'fixed') {
                const x = Number(label.getAttribute('data-anchor-x'));
                const y = Number(label.getAttribute('data-anchor-y'));
                if (!Number.isFinite(x) || !Number.isFinite(y)
                    || Math.abs(label.x.baseVal.getItem(0).value - x) > 0.01 || Math.abs(label.y.baseVal.getItem(0).value - y) > 0.01) {
                    issues.push(`固定说明“${label.textContent}”偏离原锚点`);
                }
            }
            if (label.getAttribute('data-figure-label') === 'circle') {
                const x = Number(label.getAttribute('data-center-x'));
                const y = Number(label.getAttribute('data-center-y'));
                const radius = Number(label.getAttribute('data-region-radius'));
                const corners = [box.x, box.x + box.width].flatMap((cx) => [box.y, box.y + box.height].map((cy) => ({ x: cx, y: cy })));
                if (![x, y, radius].every(Number.isFinite) || radius <= 0
                    || !corners.every((point) => Math.hypot(point.x - x, point.y - y) < radius)) issues.push(`圆名“${label.textContent}”越过所属圆的边界`);
                const circles = shapes.filter((element) => element.tagName === 'circle' && Number(element.getAttribute('r')) > 7);
                if (!circles.some((element) => Math.hypot(Number(element.getAttribute('cx')) - x, Number(element.getAttribute('cy')) - y) < 0.01
                    && Math.abs(Number(element.getAttribute('r')) - radius) < 0.01)) issues.push(`圆名“${label.textContent}”没有对应圆`);
                for (const other of circles) {
                    const ox = Number(other.getAttribute('cx'));
                    const oy = Number(other.getAttribute('cy'));
                    const otherRadius = Number(other.getAttribute('r'));
                    if (Math.hypot(ox - x, oy - y) + radius <= otherRadius + 0.01) continue;
                    const nx = Math.max(box.x, Math.min(ox, box.x + box.width));
                    const ny = Math.max(box.y, Math.min(oy, box.y + box.height));
                    if (Math.hypot(nx - ox, ny - oy) < otherRadius) issues.push(`圆名“${label.textContent}”落入其它圆内部`);
                }
            }
            if (['angle', 'sector', 'arc'].includes(label.getAttribute('data-figure-label') ?? '')) {
                const region = {
                    x: Number(label.getAttribute('data-center-x')), y: Number(label.getAttribute('data-center-y')),
                    start: Number(label.getAttribute('data-angle-start')), delta: Number(label.getAttribute('data-angle-delta')),
                    inner: Number(label.getAttribute('data-region-inner')), outer: Number(label.getAttribute('data-region-outer')),
                };
                const nearest = { x: Math.max(box.x, Math.min(region.x, box.x + box.width)), y: Math.max(box.y, Math.min(region.y, box.y + box.height)) };
                if (!Object.values(region).every(Number.isFinite) || region.inner < 0 || region.outer <= region.inner
                    || Math.abs(region.delta) < 1e-6 || Math.abs(region.delta) >= Math.PI * 2
                    || Math.hypot(nearest.x - region.x, nearest.y - region.y) < region.inner - 0.5) {
                    issues.push(`标注“${label.textContent}”越过所属区域的内边界`);
                }
                // 沿实际文字框四边独立采样，避免优弧非凸区域仅四角正确、边却穿过其它扇形。
                let outside = false;
                const samples = Math.ceil(Math.max(box.width, box.height));
                for (let index = 0; index <= samples; index += 1) {
                    const ratio = index / samples;
                    for (const [x, y] of [[box.x + box.width * ratio, box.y], [box.x + box.width * ratio, box.y + box.height], [box.x, box.y + box.height * ratio], [box.x + box.width, box.y + box.height * ratio]]) {
                        const angle = (Math.atan2(y - region.y, x - region.x) - region.start) * Math.sign(region.delta);
                        const along = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                        if (Math.hypot(x - region.x, y - region.y) > region.outer + 0.5
                            || (along > Math.abs(region.delta) + 0.002 && Math.PI * 2 - along > 0.002)) outside = true;
                    }
                }
                if (outside) issues.push(`标注“${label.textContent}”越过所属角度或扇形区域`);
            }
            if (label.getAttribute('data-figure-label') === 'point') {
                const x = Number(label.getAttribute('data-point-x'));
                const y = Number(label.getAttribute('data-point-y'));
                const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                const distance = Math.hypot(center.x - x, center.y - y);
                if (!markers.some((marker) => Math.hypot(marker.cx.baseVal.value - x, marker.cy.baseVal.value - y) < 0.01)) issues.push(`点名“${label.textContent}”没有对应点`);
                if (markers.some((marker) => {
                    const otherX = marker.cx.baseVal.value;
                    const otherY = marker.cy.baseVal.value;
                    return Math.hypot(otherX - x, otherY - y) > 0.01 && Math.hypot(center.x - otherX, center.y - otherY) < distance - 0.5;
                })) issues.push(`点名“${label.textContent}”更靠近其它点`);
            }
            if (label.getAttribute('data-figure-label') === 'segment') {
                const from = { x: Number(label.getAttribute('data-from-x')), y: Number(label.getAttribute('data-from-y')) };
                const to = { x: Number(label.getAttribute('data-to-x')), y: Number(label.getAttribute('data-to-y')) };
                const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const length = Math.hypot(dx, dy);
                const projection = (point: { x: number; y: number }) => ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
                const ratio = projection(center) / length;
                const near = (first: { x: number; y: number }, second: { x: number; y: number }) => Math.hypot(first.x - second.x, first.y - second.y) < 0.01;
                if (!segments.some((segment) => {
                    const a = { x: segment.x1.baseVal.value, y: segment.y1.baseVal.value };
                    const b = { x: segment.x2.baseVal.value, y: segment.y2.baseVal.value };
                    return (near(a, from) && near(b, to)) || (near(a, to) && near(b, from));
                })) issues.push(`标注“${label.textContent}”没有对应线段`);
                if (!Number.isFinite(ratio) || ratio < 0.3 || ratio > 0.7) issues.push(`标注“${label.textContent}”偏离线段中部`);
                const distanceTo = (a: { x: number; y: number }, b: { x: number; y: number }) => {
                    const squared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
                    const t = squared ? Math.max(0, Math.min(1, ((center.x - a.x) * (b.x - a.x) + (center.y - a.y) * (b.y - a.y)) / squared)) : 0;
                    return Math.hypot(center.x - a.x - (b.x - a.x) * t, center.y - a.y - (b.y - a.y) * t);
                };
                for (const segment of segments) {
                    const a = { x: segment.x1.baseVal.value, y: segment.y1.baseVal.value };
                    const b = { x: segment.x2.baseVal.value, y: segment.y2.baseVal.value };
                    // 同一直线上的重叠直径、半径可分别标注；不据此报告错误归属。
                    if ([a, b].every((point) => Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length < 0.01)
                        && Math.max(projection(a), projection(b)) >= 0 && Math.min(projection(a), projection(b)) <= length) continue;
                    if (distanceTo(a, b) < distanceTo(from, to) - 0.5) issues.push(`标注“${label.textContent}”更靠近其它线段`);
                }
            }
            for (const other of texts) {
                if (other === label) continue;
                const otherBox = other.getBBox();
                if (Math.min(box.x + box.width, otherBox.x + otherBox.width) - Math.max(box.x, otherBox.x) > 0.5
                    && Math.min(box.y + box.height, otherBox.y + otherBox.height) - Math.max(box.y, otherBox.y) > 0.5) {
                    issues.push(`标注“${label.textContent}”与文字“${other.textContent}”重叠`);
                }
            }
            for (const shape of shapes) {
                if (label.getAttribute('data-figure-label') === 'circle' && shape.tagName === 'circle'
                    && Number(shape.getAttribute('r')) <= 7
                    && Math.hypot(Number(shape.getAttribute('cx')) - Number(label.getAttribute('data-center-x')),
                        Number(shape.getAttribute('cy')) - Number(label.getAttribute('data-center-y'))) < 0.01) continue;
                const length = shape.getTotalLength();
                const count = Math.max(1, Math.ceil(length));
                for (let index = 0; index <= count; index += 1) {
                    const point = shape.getPointAtLength(length * index / count);
                    if (point.x > box.x - 2 && point.x < box.x + box.width + 2
                        && point.y > box.y - 2 && point.y < box.y + box.height + 2) {
                        issues.push(`标注“${label.textContent}”贴住 ${shape.tagName} 图元`);
                        break;
                    }
                }
            }
        }
        return issues;
    } finally {
        host.remove();
    }
}

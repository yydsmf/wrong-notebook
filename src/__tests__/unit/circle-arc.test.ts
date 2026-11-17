import { describe, expect, it } from 'vitest';
import { isCirclePointOnArc, resolveCircleArcDelta } from '@/lib/circle-arc';
import { renderFigureSpec } from '@/lib/figure-spec';

const FULL_TURN = Math.PI * 2;
const CENTER = { x: -13.5, y: 22 };
const RADIUS = 30;
const angleSteps = Array.from({ length: 24 }, (_, index) => index * FULL_TURN / 24);

function pointAt(angle: number) {
    return {
        x: CENTER.x + Math.cos(angle) * RADIUS,
        y: CENTER.y + Math.sin(angle) * RADIUS,
    };
}

function positiveAngleDelta(value: number): number {
    return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

describe('circle arc direction invariants', () => {
    it('keeps minor and major arc size stable when endpoint order is reversed', () => {
        for (const start of angleSteps) {
            for (const end of angleSteps) {
                const positiveEnd = positiveAngleDelta(end - start);
                if (positiveEnd < Math.PI / 180 || FULL_TURN - positiveEnd < Math.PI / 180
                    || Math.abs(positiveEnd - Math.PI) <= Math.PI / 180) continue;

                for (const arcType of ['minor', 'major'] as const) {
                    const delta = resolveCircleArcDelta(CENTER, pointAt(start), pointAt(end), { arcType });
                    const reversed = resolveCircleArcDelta(CENTER, pointAt(end), pointAt(start), { arcType });
                    const expected = arcType === 'minor'
                        ? Math.min(positiveEnd, FULL_TURN - positiveEnd)
                        : Math.max(positiveEnd, FULL_TURN - positiveEnd);

                    expect(delta).not.toBeNull();
                    expect(reversed).not.toBeNull();
                    expect(Math.abs(delta!)).toBeCloseTo(expected, 10);
                    expect(delta! + reversed!).toBeCloseTo(0, 10);
                }
            }
        }
    });

    it('selects either directed arc through an interior point, including across angle zero', () => {
        for (const start of angleSteps) {
            for (const end of angleSteps) {
                const positiveEnd = positiveAngleDelta(end - start);
                if (positiveEnd < Math.PI / 180 || FULL_TURN - positiveEnd < Math.PI / 180) continue;

                for (const positive of [true, false]) {
                    const span = positive ? positiveEnd : FULL_TURN - positiveEnd;
                    for (const fraction of [0.25, 0.5, 0.75]) {
                        const direction = positive ? 1 : -1;
                        const throughAngle = start + direction * span * fraction;
                        const through = pointAt(throughAngle);
                        const delta = resolveCircleArcDelta(CENTER, pointAt(start), pointAt(end), { through });
                        const reversed = resolveCircleArcDelta(CENTER, pointAt(end), pointAt(start), { through });
                        const oppositeMidpoint = pointAt(start - direction * (FULL_TURN - span) / 2);

                        expect(delta).not.toBeNull();
                        expect(Math.abs(delta!)).toBeCloseTo(span, 10);
                        expect(Math.sign(delta!)).toBe(direction);
                        expect(reversed! + delta!).toBeCloseTo(0, 10);
                        expect(isCirclePointOnArc(CENTER, pointAt(start), delta!, through)).toBe(true);
                        expect(isCirclePointOnArc(CENTER, pointAt(start), delta!, oppositeMidpoint)).toBe(false);
                    }
                }
            }
        }
    });

    it('maps resolved direction and arc size to SVG sweep flags in every quadrant', () => {
        const center = { id: 'O', x: 50, y: 50 };
        const figurePoint = (id: string, angle: number) => ({
            id,
            x: center.x + Math.cos(angle) * RADIUS,
            y: center.y + Math.sin(angle) * RADIUS,
        });

        for (const start of Array.from({ length: 8 }, (_, index) => index * FULL_TURN / 8)) {
            for (const end of Array.from({ length: 8 }, (_, index) => index * FULL_TURN / 8)) {
                const positiveEnd = positiveAngleDelta(end - start);
                if (positiveEnd < Math.PI / 180 || FULL_TURN - positiveEnd < Math.PI / 180
                    || Math.abs(positiveEnd - Math.PI) <= Math.PI / 180) continue;

                for (const arcType of ['minor', 'major'] as const) {
                    const from = figurePoint('A', start);
                    const to = figurePoint('B', end);
                    const delta = resolveCircleArcDelta(center, from, to, { arcType });
                    const svg = renderFigureSpec(JSON.stringify({
                        type: 'circle_geometry', center, radius: RADIUS,
                        points: [from, to], arcs: [{ from: 'A', to: 'B', arcType }],
                    }));
                    const document = new DOMParser().parseFromString(svg ?? '', 'image/svg+xml');
                    const path = document.querySelector('path')?.getAttribute('d');
                    const flags = path?.match(/\bA [\d.]+ [\d.]+ 0 ([01]) ([01]) /u);

                    expect(delta).not.toBeNull();
                    expect(flags).not.toBeNull();
                    expect(flags?.[1]).toBe(Math.abs(delta!) > Math.PI ? '1' : '0');
                    expect(flags?.[2]).toBe(delta! > 0 ? '1' : '0');
                }
            }
        }
    });

    it('requires a through point to resolve near-semicircle direction and rejects conflicting arc types', () => {
        const from = pointAt(0);
        const nearDiameter = pointAt(Math.PI - Math.PI / 360);
        const exactDiameter = pointAt(Math.PI);

        expect(resolveCircleArcDelta(CENTER, from, nearDiameter, {})).toBeNull();
        expect(resolveCircleArcDelta(CENTER, from, nearDiameter, { arcType: 'major' })).toBeNull();
        expect(resolveCircleArcDelta(CENTER, from, nearDiameter, { through: pointAt(Math.PI / 2) }))
            .toBeCloseTo(Math.PI - Math.PI / 360, 10);
        expect(resolveCircleArcDelta(CENTER, from, nearDiameter, { through: pointAt(-Math.PI / 2) }))
            .toBeCloseTo(-(Math.PI + Math.PI / 360), 10);
        expect(resolveCircleArcDelta(CENTER, from, exactDiameter, { through: pointAt(Math.PI / 2) }))
            .toBeCloseTo(Math.PI, 10);
        expect(resolveCircleArcDelta(CENTER, from, exactDiameter, { through: pointAt(-Math.PI / 2) }))
            .toBeCloseTo(-Math.PI, 10);
    });
});

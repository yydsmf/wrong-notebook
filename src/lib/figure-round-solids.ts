import { z } from 'zod';
import { validateFigureLengths, validateFigureRightTriangleLengths } from './figure-measurements';
import type { FigurePoint } from './figure-label-layout';

export const roundSolidSchema = z.object({
    type: z.literal('round_solid'),
    shape: z.enum(['cylinder', 'cone']),
    radius: z.number().finite().positive().max(100),
    height: z.number().finite().positive().max(100),
    radiusLabel: z.string().max(40).optional(),
    diameterLabel: z.string().max(40).optional(),
    heightLabel: z.string().max(40).optional(),
    slantLabel: z.string().max(40).optional(),
    title: z.string().max(100).optional(),
    fill: z.enum(['none', 'gray', 'lightblue']).default('lightblue'),
}).superRefine((value, context) => {
    if (value.shape !== 'cone' && value.slantLabel !== undefined) {
        context.addIssue({ code: 'custom', message: '母线标注只适用于圆锥模板' });
    }
});

export type RoundSolidSpec = z.infer<typeof roundSolidSchema>;

export const sphereGeometrySchema = z.object({
    type: z.literal('sphere_geometry'),
    radius: z.number().finite().positive().max(100),
    radiusLabel: z.string().max(40).optional(),
    diameterLabel: z.string().max(40).optional(),
    title: z.string().max(100).optional(),
    fill: z.enum(['none', 'gray', 'lightblue']).default('lightblue'),
});

export type SphereGeometrySpec = z.infer<typeof sphereGeometrySchema>;

const LENGTH_ROLE = /^(半径|直径|高度|母线长|母线|高|\bslant\s+height\b|\bradius\b|\bdiameter\b|\bheight\b|[rdhl](?=\s*=))/iu;
const ROLES = [
    ['radiusLabel', /^(?:半径|radius|r)$/iu],
    ['diameterLabel', /^(?:直径|diameter|d)$/iu],
    ['heightLabel', /^(?:高|高度|height|h)$/iu],
    ['slantLabel', /^(?:母线|母线长|slant\s+height|l)$/iu],
] as const;

function hasMatchingLengthRoles(spec: Partial<Record<(typeof ROLES)[number][0], string>>): boolean {
    return !ROLES.some(([key, role]) => {
        const prefix = spec[key]?.trim().match(LENGTH_ROLE)?.[1];
        return prefix && !role.test(prefix);
    });
}

export function validateSphereLengths(spec: SphereGeometrySpec): boolean {
    return hasMatchingLengthRoles(spec)
        && validateFigureLengths([{ label: spec.radiusLabel }, { label: spec.diameterLabel, multiple: 2 }], true);
}

/** 完整数值只参与关系核对；示意尺寸不冒充题目物理长度，也不求未知量。 */
export function validateRoundSolidLengths(spec: RoundSolidSpec): boolean {
    if (!hasMatchingLengthRoles(spec)) return false;
    const radius = [{ label: spec.radiusLabel }, { label: spec.diameterLabel, multiple: 2 as const }];
    return validateFigureLengths(radius, true)
        && validateFigureLengths([{ label: spec.heightLabel }, { label: spec.slantLabel }])
        && (spec.shape !== 'cone' || validateFigureRightTriangleLengths(radius, [{ label: spec.heightLabel }], [{ label: spec.slantLabel }]));
}

/** 正圆柱、正圆锥的轴测示意；圆锥轮廓与底面椭圆相切，不随标签改变比例。 */
export function projectRoundSolid(spec: Pick<RoundSolidSpec, 'shape' | 'radius' | 'height'>): {
    center: FigurePoint;
    top: FigurePoint;
    rx: number;
    ry: number;
    height: number;
    left: FigurePoint;
    right: FigurePoint;
    tangentAngle: number;
} | null {
    const angle = Math.min(Math.PI / 9, Math.atan(spec.height / spec.radius) / 2);
    const scale = Math.min(140 / spec.radius, 230 / (spec.height * Math.cos(angle) + 2 * spec.radius * Math.sin(angle)));
    const rx = spec.radius * scale;
    const ry = spec.radius * Math.sin(angle) * scale;
    const height = spec.height * Math.cos(angle) * scale;
    // 太扁、太细的图不通过改比例救图，交由完整旧图或原图兜底。
    if (![rx, ry, height].every(Number.isFinite) || rx < 24 || ry < 4 || height < 24) return null;
    const center = { x: 400, y: 90 + ry + height };
    const top = { x: center.x, y: center.y - height };
    const ratio = spec.shape === 'cone' ? ry / height : 0;
    if (ratio >= 1) return null;
    const x = rx * Math.sqrt(1 - ratio * ratio);
    const y = -ry * ratio;
    return {
        center, top, rx, ry, height,
        left: { x: center.x - x, y: center.y + y },
        right: { x: center.x + x, y: center.y + y },
        tangentAngle: Math.asin(ratio),
    };
}

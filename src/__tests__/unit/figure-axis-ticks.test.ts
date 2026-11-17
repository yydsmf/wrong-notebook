import { describe, expect, it } from 'vitest';
import { createFigureAxisTicks } from '@/lib/figure-axis-ticks';

describe('数轴与坐标轴的精确刻度', () => {
    it.each([
        { min: 0, max: 0.3, step: 0.1, labels: ['0', '0.1', '0.2', '0.3'] },
        { min: -0.3, max: 0.3, step: 0.1, labels: ['-0.3', '-0.2', '-0.1', '0', '0.1', '0.2', '0.3'] },
        { min: 0.05, max: 0.35, step: 0.1, labels: ['0.05', '0.15', '0.25', '0.35'] },
        { min: 0, max: 1, step: 0.4, labels: ['0', '0.4', '0.8'] },
        { min: 0, max: 0.29, step: 0.1, labels: ['0', '0.1', '0.2'] },
        { min: 1e-7, max: 3e-7, step: 1e-7, labels: ['0.0000001', '0.0000002', '0.0000003'] },
        { min: -0, max: 2, step: 1, labels: ['0', '1', '2'] },
        { min: 0, max: 1, step: 2, labels: ['0'] },
    ])('按完整十进制值生成 $min 到 $max 的刻度，步长 $step', ({ min, max, step, labels }) => {
        const ticks = createFigureAxisTicks(min, max, step);
        expect(ticks?.map((tick) => tick.label)).toEqual(labels);
        expect(ticks?.map((tick) => tick.value)).toEqual(labels.map(Number));
    });

    it('精确保留第 25 个刻度，不因浮点除法少算一个', () => {
        const ticks = createFigureAxisTicks(0, 2.4, 0.1);
        expect(ticks).toHaveLength(25);
        expect(ticks?.at(-1)).toEqual({ value: 2.4, label: '2.4' });
        expect(new Set(ticks?.map((tick) => tick.label)).size).toBe(25);
    });

    it('支持科学计数法表示的极小有限数，不把非零刻度改成零', () => {
        const ticks = createFigureAxisTicks(0, Number.MIN_VALUE * 2, Number.MIN_VALUE);
        expect(ticks?.map((tick) => tick.value)).toEqual([0, Number.MIN_VALUE, Number.MIN_VALUE * 2]);
        expect(ticks?.map((tick) => tick.label)).toEqual(['0', `0.${'0'.repeat(323)}5`, `0.${'0'.repeat(322)}1`]);
    });

    it.each([
        [0, 1, 0], [0, 1, -1], [1, 1, 1], [2, 1, 1],
        [Number.NaN, 1, 1], [0, Number.POSITIVE_INFINITY, 1], [0, 1, Number.NaN],
        [0.3, 2.8, 0.1], [0, 25, 1],
        [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
        [9007199254740992, 9007199254740996, 1],
    ])('无效、超过容量或无法区分的数值范围回退：%s / %s / %s', (min, max, step) => {
        expect(createFigureAxisTicks(min, max, step)).toBeNull();
    });
});

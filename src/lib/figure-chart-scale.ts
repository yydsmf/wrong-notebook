export interface FigureChartDomain {
    min: number;
    max: number;
}

type FigureChartScaleInput = {
    type: 'bar_chart' | 'line_chart';
    values: readonly number[];
    maxValue?: number;
    minValue?: number;
};

/**
 * 计算图表的实际数值范围。柱状图保留 0 基线，折线图只在未声明边界时补 0，
 * 避免把 0.2～0.5 之类的小数范围无条件扩大到 1，或把全为负数的数据上限扩大到 1。
 */
export function getFigureChartDomain(spec: FigureChartScaleInput): FigureChartDomain | null {
    if (!spec.values.length || spec.values.some((value) => !Number.isFinite(value))) return null;
    if (spec.type === 'line_chart' && spec.maxValue !== undefined && spec.minValue !== undefined
        && spec.maxValue <= spec.minValue) return null;

    const dataMin = Math.min(...spec.values);
    const dataMax = Math.max(...spec.values);
    if (spec.type === 'bar_chart' && dataMin < 0) return null;
    if (spec.maxValue !== undefined && spec.maxValue < dataMax) return null;
    if (spec.minValue !== undefined && spec.minValue > dataMin) return null;
    const min = spec.type === 'bar_chart'
        ? 0
        : Math.min(dataMin, spec.minValue ?? 0);
    const max = spec.type === 'bar_chart'
        ? Math.max(dataMax, spec.maxValue ?? 1)
        : Math.max(dataMax, spec.maxValue ?? 0);

    if (![min, max].every(Number.isFinite) || max < min) return null;
    const span = max - min;
    if (max > min && Number.isFinite(span)) return { min, max };

    // 只有所有数据和显式边界完全相等时才会退化；给折线图留出稳定的可视范围。
    if (spec.type === 'bar_chart' || !Number.isFinite(min)) return null;
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    const paddedMin = min - padding;
    const paddedMax = max + padding;
    return [paddedMin, paddedMax, paddedMax - paddedMin].every(Number.isFinite)
        && paddedMax > paddedMin ? { min: paddedMin, max: paddedMax } : null;
}

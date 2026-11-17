import { describe, expect, it } from 'vitest';
import { getFigureChartDomain } from '@/lib/figure-chart-scale';

describe('结构化图表数值范围', () => {
    it('柱状图保留零基线并尊重不小于数据最大值的显式上限', () => {
        expect(getFigureChartDomain({ type: 'bar_chart', values: [0.2, 0.5], maxValue: 0.6 })).toEqual({ min: 0, max: 0.6 });
        expect(getFigureChartDomain({ type: 'bar_chart', values: [2, 5] })).toEqual({ min: 0, max: 5 });
    });

    it('折线图不把小数上限无条件抬到 1', () => {
        expect(getFigureChartDomain({ type: 'line_chart', values: [0.2, 0.5] })).toEqual({ min: 0, max: 0.5 });
        expect(getFigureChartDomain({ type: 'line_chart', values: [0.2, 0.5], minValue: 0.1, maxValue: 0.6 })).toEqual({ min: 0.1, max: 0.6 });
    });

    it('全为负数时不额外制造 1 的上限', () => {
        expect(getFigureChartDomain({ type: 'line_chart', values: [-5, -3] })).toEqual({ min: -5, max: 0 });
        expect(getFigureChartDomain({ type: 'line_chart', values: [-5, -3], minValue: -6, maxValue: -2 })).toEqual({ min: -6, max: -2 });
    });

    it('所有数据相等时仍提供非零显示范围', () => {
        expect(getFigureChartDomain({ type: 'line_chart', values: [0.2, 0.2] })).toEqual({ min: 0, max: 0.2 });
        expect(getFigureChartDomain({ type: 'line_chart', values: [0, 0] })).toEqual({ min: -1, max: 1 });
    });

    it('范围反向时回退', () => {
        expect(getFigureChartDomain({ type: 'line_chart', values: [1, 2], minValue: 3, maxValue: 2 })).toBeNull();
        expect(getFigureChartDomain({ type: 'line_chart', values: [1, 2], maxValue: 1 })).toBeNull();
        expect(getFigureChartDomain({ type: 'line_chart', values: [1, 2], minValue: 3 })).toBeNull();
        expect(getFigureChartDomain({ type: 'bar_chart', values: [-1, 2] })).toBeNull();
    });
});

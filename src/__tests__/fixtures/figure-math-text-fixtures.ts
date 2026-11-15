import type { FigureSpecFixture } from './figure-spec-fixtures';

const gridTokens = ['12.5 cm', '3 / 25', 'x² + y²', '−0.75 m/s', '3 × 10⁴', '120 千米/小时', '√2', '2 3/4'];
const tableTokens = ['12.5 cm', '3 / 25', 'x² + y²', '√2', '2 3/4', 'xᵢ'];
const tableSourceTokens = ['12.5 cm', '3  /  25', 'x²  +  y²', '√2', '2  3/4', 'xᵢ'];
const groupTitle = '请完整保留图中标注并根据题目要求比较x² + y²与3 / 25的结果,结合两个图示说明判断的理由';

export const MATH_TEXT_FIGURE_FIXTURES: FigureSpecFixture[] = [
    {
        id: 'math-text-grid', stage: '小学', type: 'grid_shape',
        spec: { type: 'grid_shape', rows: 5, cols: 5, cellLabels: gridTokens.map((token, index) => ({
            row: Math.floor(index / 2), col: (index % 2) * 3, text: `数值为${token}时`,
        })), title: '数学标注保持完整' },
        mustContain: [], mustHaveText: gridTokens.map((token) => `数值为${token}时`), unbrokenText: gridTokens,
    },
    {
        id: 'math-text-table', stage: '初中', type: 'table',
        spec: { type: 'table', headers: ['长度', '分数', '算式', '根号', '带分数', '下标'], rows: [tableSourceTokens.map((token) => `数值为${token}时`)] },
        mustContain: [], mustHaveText: tableTokens.map((token) => `数值为${token}时`), unbrokenText: tableTokens,
    },
    {
        id: 'math-text-chart', stage: '小学', type: 'bar_chart',
        spec: { type: 'bar_chart', categories: ['速度为120 千米/小时时', '面积为12.5 cm²时'], values: [4, 5] },
        mustContain: [], mustHaveText: ['速度为120 千米/小时时', '面积为12.5 cm²时'], unbrokenText: ['120 千米/小时', '12.5 cm²'],
    },
    {
        id: 'math-text-group-title', stage: '初中', type: 'figure_group',
        spec: { type: 'figure_group', title: groupTitle, figures: [
            { label: 'A', figure: { type: 'fraction', numerator: '1', denominator: '2' } },
            { label: 'B', figure: { type: 'fraction', numerator: '3', denominator: '4' } },
        ] },
        mustContain: [], mustHaveText: [groupTitle], unbrokenText: ['x² + y²', '3 / 25'],
    },
];

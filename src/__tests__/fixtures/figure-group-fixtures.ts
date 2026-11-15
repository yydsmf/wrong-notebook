import { STRUCTURED_FIGURE_FIXTURES } from './figure-spec-fixtures';

function fixture(id: string): Record<string, unknown> {
    const result = STRUCTURED_FIGURE_FIXTURES.find((entry) => entry.id === id);
    if (!result) throw new Error(`缺少图组引用样本：${id}`);
    return result.spec;
}

export function circleOption(radius: number): Record<string, unknown> {
    return { type: 'basic_geometry', points: [{ id: 'O', x: 50, y: 50, label: 'O' }], circles: [{ center: 'O', radius }] };
}

interface FigureGroupFixture {
    id: string;
    spec: {
        type: 'figure_group';
        title?: string;
        compareSizes?: boolean;
        figures: Array<{ label: string; figure: Record<string, unknown> }>;
    };
    unbrokenText?: string[];
}

export const FIGURE_GROUP_FIXTURES: FigureGroupFixture[] = [
    {
        id: 'four-circles',
        spec: {
            type: 'figure_group', title: '比较四个圆的大小', compareSizes: true,
            figures: [12, 18, 24, 30].map((radius, index) => ({ label: 'ABCD'[index], figure: circleOption(radius) })),
        },
    },
    {
        id: 'four-fractions',
        spec: {
            type: 'figure_group', title: '四个选项的涂色部分',
            figures: [1, 2, 3, 4].map((filled, index) => ({ label: 'ABCD'[index], figure: {
                type: 'fraction', numerator: String(filled), denominator: '4', model: 'circle', parts: 4, filled,
            } })),
        },
    },
    {
        id: 'six-geometries',
        spec: {
            type: 'figure_group',
            figures: [5, 10, 15, 20, 25, 30].map((radius, index) => ({ label: `图${index + 1}`, figure: circleOption(radius) })),
        },
    },
    {
        id: 'repeated-point-ids',
        spec: {
            type: 'figure_group', title: '各选项的顶点独立',
            figures: [0, 1, 2, 3].map((index) => ({ label: 'ABCD'[index], figure: {
                type: 'basic_geometry', points: [
                    { id: 'A', x: 20, y: 70, label: 'A' }, { id: 'B', x: 80, y: 70, label: 'B' },
                    { id: 'C', x: 30 + index * 10, y: 25, label: 'C' },
                ], polygons: [{ points: ['A', 'B', 'C'], fill: 'lightblue' }],
            } })),
        },
    },
    {
        id: 'mixed-three-panels',
        spec: {
            type: 'figure_group', title: '同题的三个独立图示',
            figures: [
                { label: '甲', figure: fixture('primary-vertical-multiplication') },
                { label: '乙', figure: fixture('primary-triangle-side-lengths') },
                { label: '丙', figure: { type: 'table', headers: ['数量', '单位'], rows: [['3', '厘米'], ['4', '厘米']] } },
            ],
        },
    },
    {
        id: 'circle-and-coordinate',
        spec: {
            type: 'figure_group',
            figures: [
                { label: '图1', figure: fixture('junior-title-circle') },
                { label: '图2', figure: fixture('junior-title-coordinate') },
            ],
        },
    },
    {
        id: 'long-group-title',
        spec: {
            type: 'figure_group', title: '完整保留这段标题'.repeat(5), compareSizes: true,
            figures: [12, 30].map((radius, index) => ({ label: 'AB'[index], figure: circleOption(radius) })),
        },
    },
    {
        id: 'long-group-math-title',
        spec: {
            type: 'figure_group', title: '已知圆的面积为12345cm²，观察 A₁、A₂ 对应的圆形与下方图示，比较半径和直径后回答问题',
            figures: [12, 30].map((radius, index) => ({ label: 'AB'[index], figure: circleOption(radius) })),
        },
        unbrokenText: ['12345cm²', 'A₁', 'A₂'],
    },
];

export const FIGURE_GROUP_PROVIDER_RESPONSE = '<has_figure>true</has_figure><figure_spec>'
    + JSON.stringify(FIGURE_GROUP_FIXTURES[0].spec)
    + '</figure_spec><figure_svg><svg><text>legacy</text></svg></figure_svg>';

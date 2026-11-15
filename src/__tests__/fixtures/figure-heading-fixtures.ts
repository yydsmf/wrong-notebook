import { STRUCTURED_FIGURE_FIXTURES } from './figure-spec-fixtures';
import type { FigureSpecFixture } from './figure-spec-fixtures';

function titled(id: string, title: string, unbrokenText?: string[]): FigureSpecFixture {
    const fixture = STRUCTURED_FIGURE_FIXTURES.find((entry) => entry.id === id);
    if (!fixture) throw new Error(`缺少标题引用样本：${id}`);
    return { ...fixture, id: `heading-${id}`, spec: { ...fixture.spec, title }, mustContain: [title], unbrokenText };
}

export const HEADING_FIGURE_FIXTURES: FigureSpecFixture[] = [
    titled('junior-title-circle', '完整保留标题'.repeat(10)),
    titled('junior-title-coordinate', '完整保留标题'.repeat(10)),
    titled('junior-circle-major-and-semicircle', '观察圆形中的优弧与半圆，完整保留阴影方向和所有点名，按照图示回答问题'),
    titled('junior-coordinate-side-lengths', '已知线段长为12.5cm，观察 A₁ 与 A₂ 对应的坐标，按照图中的点名与标注回答问题', ['12.5cm', 'A₁', 'A₂']),
    titled('junior-coordinate-unit-square-landscape', '观察横纵轴的单位长度与下方图形，判断图中的四边形是否为正方形并说明理由'),
    {
        id: 'heading-circle-top-boundary', stage: '初中' as const, type: 'circle_geometry',
        spec: { type: 'circle_geometry', center: { id: 'O', x: 50, y: 20, label: 'O' }, radius: 15, title: '观察接近画布顶端的圆形，完整保留圆心名称与圆周边界，按照图示回答问题' },
        mustContain: ['O'],
    },
];

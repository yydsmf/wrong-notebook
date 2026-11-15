import type { FigureSpecFixture } from './figure-spec-fixtures';

/** 面积和立体图的尺寸归属样本；浏览器还须用实际字体检查标注是否压线。 */
export const DIMENSION_FIGURE_FIXTURES: FigureSpecFixture[] = [
    {
        id: 'dimension-triangle', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: 0.35, baseLabel: '底6厘米', heightLabel: '高4厘米', title: '三角形的底和高' },
        mustContain: ['底6厘米', '高4厘米', '三角形的底和高'],
    },
    {
        id: 'dimension-rectangle-wide', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'rectangle', width: 12, height: 2, baseLabel: '长12厘米', heightLabel: '宽2厘米', title: '观察长方形的长与宽，按图中给出的长度计算面积（单位：厘米）' },
        mustContain: ['长12厘米', '宽2厘米', '观察长方形'],
    },
    {
        id: 'dimension-rectangle-tall', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'rectangle', width: 2, height: 12, baseLabel: '2cm', heightLabel: '长12厘米' },
        mustContain: ['2cm', '长12厘米'],
    },
    {
        id: 'dimension-square', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'square', width: 5, height: 5, baseLabel: '边长5cm', heightLabel: '边长5cm', title: '正方形' },
        mustContain: ['边长5cm', '正方形'],
    },
    {
        id: 'dimension-parallelogram', stage: '初中', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'parallelogram', width: 6, height: 4, offset: 1, baseLabel: '底6厘米', heightLabel: '高4厘米' },
        mustContain: ['底6厘米', '高4厘米'],
    },
    {
        id: 'dimension-trapezoid', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'trapezoid', width: 8, height: 4, topWidth: 5, offset: 0.5, baseLabel: '下底8厘米', topLabel: '上底5厘米', heightLabel: '高4厘米' },
        mustContain: ['下底8厘米', '上底5厘米', '高4厘米'],
    },
    {
        id: 'dimension-cuboid', stage: '小学', type: 'solid_geometry',
        spec: { type: 'solid_geometry', shape: 'cuboid', width: 6, depth: 4, height: 5, widthLabel: '长6厘米', depthLabel: '宽4厘米', heightLabel: '高5厘米', title: '长方体的三种尺寸' },
        mustContain: ['长6厘米', '宽4厘米', '高5厘米', '长方体的三种尺寸'],
    },
    {
        id: 'dimension-cuboid-tall', stage: '初中', type: 'solid_geometry',
        spec: { type: 'solid_geometry', shape: 'cuboid', width: 3, depth: 3, height: 8, widthLabel: '长3', depthLabel: '宽3', heightLabel: '高8' },
        mustContain: ['长3', '宽3', '高8'],
    },
    {
        id: 'dimension-cuboid-wide', stage: '小学', type: 'solid_geometry',
        spec: { type: 'solid_geometry', shape: 'cuboid', width: 10, depth: 4, height: 2, widthLabel: '长10', depthLabel: '宽4', heightLabel: '高2' },
        mustContain: ['长10', '宽4', '高2'],
    },
    {
        id: 'dimension-cube', stage: '小学', type: 'solid_geometry',
        spec: { type: 'solid_geometry', shape: 'cube', width: 4, depth: 4, height: 4, widthLabel: '棱长4厘米' },
        mustContain: ['棱长4厘米'],
    },
    {
        id: 'dimension-area-long-title', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'square', width: 5, height: 5, baseLabel: '边长5厘米', title: '完整保留标题'.repeat(10) },
        mustContain: ['边长5厘米', '完整保留标题'.repeat(10)],
    },
    {
        id: 'dimension-solid-math-title', stage: '初中', type: 'solid_geometry',
        spec: { type: 'solid_geometry', shape: 'cuboid', width: 6, depth: 4, height: 5, widthLabel: '长6厘米', title: '已知体积为12345cm³，观察图中 A₁ 与 A₂ 的关系后回答问题' },
        mustContain: ['12345cm³', 'A₁', 'A₂', '长6厘米'],
        unbrokenText: ['12345cm³', 'A₁', 'A₂'],
    },
    {
        id: 'dimension-triangle-top-title', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 6, baseLabel: '底6厘米', heightLabel: '高6厘米', topLabel: '顶点A', title: '观察三角形的底和高，使用图中的数据计算涂色部分的面积' },
        mustContain: ['底6厘米', '高6厘米', '顶点A', '观察三角形'],
    },
];

export const UNREADABLE_DIMENSION_SPECS = [
    { type: 'area_geometry', shape: 'rectangle', width: 100, height: 0.1, baseLabel: '长100', heightLabel: '宽0.1' },
    { type: 'area_geometry', shape: 'rectangle', width: 0.1, height: 100, baseLabel: '宽0.1', heightLabel: '长100' },
    { type: 'area_geometry', shape: 'trapezoid', width: 100, height: 30, topWidth: 0.1, topLabel: '上底0.1' },
    { type: 'area_geometry', shape: 'rectangle', width: 6, height: 4, heightLabel: '完整保留的长度单位说明文字' },
    { type: 'area_geometry', shape: 'square', width: 5, height: 5, title: '1234567890'.repeat(6) },
    { type: 'solid_geometry', shape: 'cuboid', width: 0.1, depth: 10, height: 10, widthLabel: '长0.1' },
    { type: 'solid_geometry', shape: 'cuboid', width: 10, depth: 0.1, height: 10, depthLabel: '宽0.1' },
    { type: 'solid_geometry', shape: 'cuboid', width: 10, depth: 10, height: 0.1, heightLabel: '高0.1' },
    { type: 'solid_geometry', shape: 'cube', width: 5, depth: 5, height: 5, heightLabel: '完整保留的长度单位说明文字' },
    { type: 'solid_geometry', shape: 'cube', width: 5, depth: 5, height: 5, title: '1234567890'.repeat(6) },
];

import type { FigureSpecFixture } from './figure-spec-fixtures';

export interface ExteriorAltitudeFixture extends FigureSpecFixture {
    footRatio: number;
    baseHeightRatio: number;
}

/** 独立构造的外部高样本，仅验证结构和绘图，不替代真实图片识别。 */
export const EXTERIOR_ALTITUDE_FIXTURES: ExteriorAltitudeFixture[] = [
    {
        id: 'triangle-altitude-left', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: -0.5, baseLabel: '底6厘米', heightLabel: '高4厘米', title: '三角形的底和外部高' },
        mustContain: ['底6厘米', '高4厘米', '三角形的底和外部高'], footRatio: -0.5, baseHeightRatio: 1.5,
    },
    {
        id: 'triangle-altitude-right', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: 1.5, baseLabel: '底6厘米', heightLabel: '高4厘米', topLabel: '顶点A' },
        mustContain: ['底6厘米', '高4厘米', '顶点A'], footRatio: 1.5, baseHeightRatio: 1.5,
    },
    {
        id: 'triangle-altitude-left-limit', stage: '初中', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: -1, baseLabel: '底6cm', heightLabel: '高4cm' },
        mustContain: ['底6cm', '高4cm'], footRatio: -1, baseHeightRatio: 1.5,
    },
    {
        id: 'triangle-altitude-right-limit', stage: '初中', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'triangle', width: 6, height: 4, apexRatio: 2, baseLabel: '底6cm', heightLabel: '高4cm' },
        mustContain: ['底6cm', '高4cm'], footRatio: 2, baseHeightRatio: 1.5,
    },
    {
        id: 'parallelogram-altitude-left', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'parallelogram', width: 6, height: 4, offset: -2, baseLabel: '底6厘米', heightLabel: '高4厘米' },
        mustContain: ['底6厘米', '高4厘米'], footRatio: -1 / 3, baseHeightRatio: 1.5,
    },
    {
        id: 'parallelogram-altitude-right', stage: '小学', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'parallelogram', width: 6, height: 4, offset: 8, baseLabel: '底6厘米', heightLabel: '高4厘米' },
        mustContain: ['底6厘米', '高4厘米'], footRatio: 7 / 3, baseHeightRatio: 1.5,
    },
    {
        id: 'trapezoid-altitude-left', stage: '初中', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'trapezoid', width: 8, height: 4, topWidth: 5, offset: -3, baseLabel: '下底8厘米', topLabel: '上底5厘米', heightLabel: '高4厘米' },
        mustContain: ['下底8厘米', '上底5厘米', '高4厘米'], footRatio: -1.5 / 8, baseHeightRatio: 2,
    },
    {
        id: 'trapezoid-altitude-right', stage: '初中', type: 'area_geometry',
        spec: { type: 'area_geometry', shape: 'trapezoid', width: 8, height: 4, topWidth: 5, offset: 8, baseLabel: '下底8厘米', topLabel: '上底5厘米', heightLabel: '高4厘米' },
        mustContain: ['下底8厘米', '上底5厘米', '高4厘米'], footRatio: 14.5 / 8, baseHeightRatio: 2,
    },
];

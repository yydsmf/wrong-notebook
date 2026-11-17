interface RoundSolidFixture {
    id: string;
    spec: {
        type: 'round_solid';
        shape: 'cylinder' | 'cone';
        radius: number;
        height: number;
        radiusLabel?: string;
        diameterLabel?: string;
        heightLabel?: string;
        slantLabel?: string;
        title?: string;
        fill?: 'none' | 'gray' | 'lightblue';
    };
}

export const ROUND_SOLID_FIXTURES: RoundSolidFixture[] = [
    { id: 'cylinder-radius-height', spec: { type: 'round_solid', shape: 'cylinder', radius: 3, height: 5, radiusLabel: '半径3cm', heightLabel: '高5cm' } },
    { id: 'cylinder-diameter', spec: { type: 'round_solid', shape: 'cylinder', radius: 3, height: 5, diameterLabel: '直径6厘米', heightLabel: '高5厘米', fill: 'none' } },
    { id: 'cylinder-both-dimensions', spec: { type: 'round_solid', shape: 'cylinder', radius: 3, height: 5, radiusLabel: '半径3cm', diameterLabel: '直径6cm', heightLabel: '高5cm', title: '圆柱尺寸示意图' } },
    { id: 'cylinder-wide', spec: { type: 'round_solid', shape: 'cylinder', radius: 6, height: 3, radiusLabel: 'r=6', heightLabel: 'h=3', fill: 'gray' } },
    { id: 'cone-radius-height-slant', spec: { type: 'round_solid', shape: 'cone', radius: 3, height: 4, radiusLabel: '半径3cm', heightLabel: '高4cm', slantLabel: '母线5cm' } },
    { id: 'cone-diameter-height-slant', spec: { type: 'round_solid', shape: 'cone', radius: 3, height: 4, diameterLabel: '直径6cm', heightLabel: '高4cm', slantLabel: '母线5cm' } },
    { id: 'cone-all-dimensions', spec: { type: 'round_solid', shape: 'cone', radius: 3, height: 4, radiusLabel: '3cm', diameterLabel: '6cm', heightLabel: '4cm', slantLabel: '5cm', title: '圆锥的半径、直径、高和母线' } },
    { id: 'cone-unknown', spec: { type: 'round_solid', shape: 'cone', radius: 3, height: 4, radiusLabel: 'r=?cm', heightLabel: 'h=□cm', slantLabel: 'l=?cm', fill: 'none' } },
];

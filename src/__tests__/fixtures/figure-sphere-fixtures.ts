interface SphereFixture {
    id: string;
    spec: {
        type: 'sphere_geometry';
        radius: number;
        radiusLabel?: string;
        diameterLabel?: string;
        title?: string;
        fill?: 'none' | 'gray' | 'lightblue';
    };
}

export const SPHERE_FIXTURES: SphereFixture[] = [
    { id: 'sphere-radius', spec: { type: 'sphere_geometry', radius: 3, radiusLabel: '半径3cm' } },
    { id: 'sphere-diameter', spec: { type: 'sphere_geometry', radius: 3, diameterLabel: '直径6厘米', fill: 'none' } },
    { id: 'sphere-both-labels', spec: { type: 'sphere_geometry', radius: 3, radiusLabel: '半径3cm', diameterLabel: '直径6cm', title: '球体的半径与直径', fill: 'gray' } },
    { id: 'sphere-mixed-units', spec: { type: 'sphere_geometry', radius: 3, radiusLabel: 'r=1/2m', diameterLabel: 'd=100厘米' } },
    { id: 'sphere-unknown', spec: { type: 'sphere_geometry', radius: 3, radiusLabel: 'r=□cm', diameterLabel: 'd=?cm' } },
];

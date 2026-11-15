export const MIXED_FRACTION_FIXTURES = [
    { id: 'mixed-bar-two', model: 'bar', whole: 2, parts: 4, filled: 3 },
    { id: 'mixed-circle-two', model: 'circle', whole: 2, parts: 4, filled: 3 },
    { id: 'mixed-bar-zero', model: 'bar', whole: 0, parts: 4, filled: 1 },
    { id: 'mixed-circle-full', model: 'circle', whole: 1, parts: 1, filled: 1 },
    { id: 'mixed-bar-maximum', model: 'bar', whole: 5, parts: 40, filled: 13 },
    { id: 'mixed-circle-maximum', model: 'circle', whole: 5, parts: 24, filled: 7 },
    { id: 'mixed-circle-empty', model: 'circle', whole: 3, parts: 4, filled: 0 },
] as const;

export function mixedFractionSpec(fixture: typeof MIXED_FRACTION_FIXTURES[number]) {
    return { type: 'fraction', model: fixture.model, whole: String(fixture.whole), numerator: String(fixture.filled),
        denominator: String(fixture.parts), parts: fixture.parts, filled: fixture.filled, label: '每个完整图形表示一个单位' };
}

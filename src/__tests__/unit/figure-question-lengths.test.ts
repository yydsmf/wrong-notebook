import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (value: unknown) => JSON.stringify(value);
const circlePoints = [
    { id: 'a', x: 80, y: 50, label: 'A' },
    { id: 'b', x: 50, y: 20, label: 'B' },
    { id: 'c', x: 20, y: 50, label: 'C' },
];
const basic = (label?: string) => ({
    type: 'basic_geometry', points: circlePoints,
    segments: [{ from: 'a', to: 'b', label }],
});
const coordinate = (label?: string) => ({
    type: 'coordinate_plane', xMin: 0, xMax: 100, yMin: 0, yMax: 100,
    xStep: 50, yStep: 50, points: circlePoints,
    segments: [{ from: 'a', to: 'b', label }],
});
const circle = (collection: 'chords' | 'radii' | 'diameters', label?: string) => ({
    type: 'circle_geometry', center: { id: 'o', x: 50, y: 50, label: 'O' }, radius: 30,
    points: circlePoints,
    [collection]: collection === 'radii' ? [{ to: 'a', label }]
        : [{ from: 'a', to: collection === 'diameters' ? 'c' : 'b', label }],
});
const cases = [
    { name: '通用线段', make: basic, pair: 'AB' },
    { name: '坐标线段', make: coordinate, pair: 'AB' },
    { name: '圆的弦', make: (label?: string) => circle('chords', label), pair: 'AB' },
    { name: '圆的半径', make: (label?: string) => circle('radii', label), pair: 'OA' },
    { name: '圆的直径', make: (label?: string) => circle('diameters', label), pair: 'AC' },
];

describe.each(cases)('题干长度与配图标注：$name', ({ make, pair }) => {
    it('同名线段的明确数值冲突使整图回退', () => {
        const spec = raw(make('5厘米'));
        expect(parseFigureSpec(spec, `已知${pair}=5厘米。`)).not.toBeNull();
        expect(parseFigureSpec(spec, `已知${pair}=6厘米。`)).toBeNull();
        expect(renderFigureSpecDetailed(spec, `${pair}=6厘米。`)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it('反向点名对应同一线段，不能用另一条边的标签代替', () => {
        const reversed = [...pair].reverse().join('');
        const spec = raw(make('5cm'));
        expect(parseFigureSpec(spec, `${reversed}=50mm。`)).not.toBeNull();
        expect(parseFigureSpec(spec, `${reversed}=6cm。`)).toBeNull();
    });

    it('中文长度描述和英文完整声明同样核对', () => {
        for (const question of [
            `${pair}的长度为6厘米。`, `线段${pair}长6厘米。`,
            `${pair} has length 6 cm.`, `${pair} has a length of 6 cm.`,
        ]) {
            expect(parseFigureSpec(raw(make('6cm')), question), question).not.toBeNull();
            expect(parseFigureSpec(raw(make('5cm')), question), question).toBeNull();
        }
    });

    it('有限小数和分数精确比较，不改写标签或推断相对尺寸', () => {
        for (const [questionValue, label] of [
            ['1分米', '10厘米'], ['0.5m', '50cm'], ['1/2m', '50cm'],
            ['1又1/2厘米', '15mm'], ['1 1/2cm', '15mm'], ['0.3cm', '3mm'],
        ]) {
            const spec = make(label);
            const before = raw(spec);
            expect(parseFigureSpec(before, `${pair}=${questionValue}。`), questionValue).not.toBeNull();
            expect(parseFigureSpec(before, `${pair}=99cm。`), label).toBeNull();
            expect(raw(spec)).toBe(before);
        }
        expect(parseFigureSpec(raw(make('0.3cm')), `${pair}=0.3000000000000001cm。`)).toBeNull();
    });

    it('缺失单位或未知标签不擅自补值，完整文字保留', () => {
        for (const label of [undefined, '', 'x', '?', '____', '5cm²', '约5cm', '5in']) {
            expect(parseFigureSpec(raw(make(label)), `${pair}=6cm。`), label).not.toBeNull();
        }
        expect(parseFigureSpec(raw(make('5')), `${pair}=6cm。`)).not.toBeNull();
        expect(parseFigureSpec(raw(make('5cm')), `${pair}=6。`)).not.toBeNull();
        expect(parseFigureSpec(raw(make('5')), `${pair}=6。`)).toBeNull();
    });

    it('疑问、假设、否定、候选和未完成表达式不冒充已知长度', () => {
        for (const question of [
            `证明${pair}=6cm。`, `如果${pair}=6cm，求面积。`,
            `${pair}=6cm吗？`, `${pair}=6cm，这句话对吗？`,
            `Determine whether ${pair}=6cm.`, `If ${pair}=6cm, find the area.`,
            `${pair}不等于6cm。`, `${pair}≠6cm。`,
            `${pair}=6+1cm。`, `${pair}=6cm+1cm。`, `${pair}=6/□cm。`,
            `${pair}=6cm²。`, `${pair}=6e2cm。`, `${pair}=6,000cm。`,
            `下列说法正确的是：A.${pair}=6cm；B.${pair}=5cm。`,
        ]) {
            expect(parseFigureSpec(raw(make('5cm')), question), question).not.toBeNull();
        }
    });

    it('普通公式分隔符内的完整长度也不能漏检', () => {
        for (const question of [`已知$${pair}=6cm$。`, `已知\\(${pair}=6cm\\)。`]) {
            expect(parseFigureSpec(raw(make('6cm')), question), question).not.toBeNull();
            expect(parseFigureSpec(raw(make('5cm')), question), question).toBeNull();
        }
    });

    it('不从系数、相加线段和连等式的末尾截取单段长度', () => {
        for (const question of [
            `CD+${pair}=6cm。`, `2 ${pair}=6cm。`, `- ${pair}=6cm。`,
            `CD=${pair}=6cm。`, `CD\\times ${pair}=6cm。`,
            `\\sqrt ${pair}=6cm。`, `\\${pair}=6cm。`, `x^${pair}=6cm。`,
            `2 $${pair}=6cm$。`, `CD+\\(${pair}=6cm\\)。`,
            `${pair}=6cm, is this true?`, `${pair}=6cm, correct?`,
        ]) {
            expect(parseFigureSpec(raw(make('5cm')), question), question).not.toBeNull();
        }
    });

    it('明确冲突保留完整旧图，没有旧图则不返回新图', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原有长度图</text></svg>';
        const spec = raw(make('5cm'));
        expect(parseFigure('true', legacy, spec, `${pair}=6cm。`)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, `${pair}=6cm。`)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

describe('题干长度的点名和多图边界', () => {
    it('只核对实际对应端点，保留数字、下标和撇号，不截取较长名称', () => {
        const base = basic('5cm');
        const spec = { ...base, points: base.points.map((point, index) => ({ ...point, label: ['A1', 'B₂′', 'C'][index] })) };
        expect(parseFigureSpec(raw(spec), 'A1B₂′=5cm。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), 'A1B₂′=6cm。')).toBeNull();
        for (const question of ['AB₂′=6cm。', 'A1B₂=6cm。', 'a1B₂′=6cm。', 'CA1B₂′=6cm。', 'C A1 B₂′=6cm。']) {
            expect(parseFigureSpec(raw(spec), question), question).not.toBeNull();
        }
        expect(parseFigureSpec(raw(base), 'BC=6cm。')).not.toBeNull();
    });

    it('同子图重复列出的标注逐项检查，不遗漏其中的错误长度', () => {
        const base = basic('5cm');
        const spec = { ...base, segments: [...base.segments, { from: 'b', to: 'a', label: '6cm' }] };
        expect(parseFigureSpec(raw(spec), 'AB=5cm。')).toBeNull();
    });

    it('明确按子图分段时分别核对，任一冲突使整组回退', () => {
        const group = { type: 'figure_group', figures: [
            { label: '甲', figure: basic('5cm') }, { label: '乙', figure: basic('6cm') },
        ] };
        const before = raw(group);
        const valid = '图甲中：AB=5cm；图乙中：AB=6cm。';
        const invalid = '图甲中：AB=5cm；图乙中：AB=7cm。';
        expect(parseFigureSpec(before, valid)).not.toBeNull();
        expect(parseFigureSpec(before, invalid)).toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整长度图组</text></svg>';
        expect(parseFigure('true', legacy, before, invalid)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(raw(group)).toBe(before);
    });

    it('后一句求值不取消前一独立长度声明，连续关系各自核对', () => {
        const spec = basic('5cm');
        expect(parseFigureSpec(raw(spec), '已知AB=6cm。求周长。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '已知AB=5cm，BC=6cm。求周长。')).not.toBeNull();
        expect(parseFigureSpec(raw(spec), '已知BC=5cm，AB=6cm。')).toBeNull();
    });
});

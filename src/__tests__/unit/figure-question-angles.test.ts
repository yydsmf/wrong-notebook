import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (value: unknown) => JSON.stringify(value);
const angleFigure = (label: string) => ({
    type: 'basic_geometry',
    points: [
        { id: 'center', x: 35, y: 55, label: 'O' },
        { id: 'first', x: 85, y: 55, label: 'A' },
        { id: 'second', x: 60, y: 12, label: 'B' },
    ],
    segments: [{ from: 'center', to: 'first' }, { from: 'center', to: 'second' }],
    angles: [{ vertex: 'center', from: 'first', to: 'second', style: 'arc', label }],
});

describe('题干与同名角的明确度数', () => {
    it.each([
        '∠AOB=60°。', '∠BOA为60度。', '角AOB等于60°。',
        'angle AOB is 60 degrees.', 'angle BOA measures 60 degrees.',
        '∠ＡＯＢ＝６０°。', '∠AOB的度数为60度。', '∠AOB的大小等于60°。',
        '$∠AOB=60°$。', '\\(∠AOB=60°\\)。', '已知∠AOB=60°，求另一角的度数。',
    ])('相同角的冲突度数使整图回退：%s', (question) => {
        expect(parseFigureSpec(raw(angleFigure('60°')), question)).not.toBeNull();
        expect(renderFigureSpecDetailed(raw(angleFigure('120°')), question)).toMatchObject({
            svg: null, diagnostic: { reason: 'semantic_validation' },
        });
    });

    it.each([
        ['180/3°', '∠AOB=60°。'],
        ['60.00000000000000001°', '∠AOB=60.00000000000000001°。'],
        ['60 1/2度', '∠AOB=60.5度。'],
    ])('分数和小数只用于精确比较，标注保留原文：%s', (label, question) => {
        expect(parseFigureSpec(raw(angleFigure(label)), question)).toMatchObject({ angles: [{ label }] });
        expect(parseFigureSpec(raw(angleFigure(label)), question.replace(/60(?:\.\d+)?/, '61'))).toBeNull();
    });

    it('冲突时保留完整旧图，不修改输入或自动填入答案', () => {
        const spec = raw(angleFigure('120°'));
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧角度图</text></svg>';
        expect(parseFigure('true', legacy, spec, '∠AOB=60°。')).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec, '∠AOB=60°。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(spec).toBe(raw(angleFigure('120°')));
    });

    it('小数的末位差异不能被浮点舍入吞掉', () => {
        expect(parseFigureSpec(raw(angleFigure('60°')), '∠AOB=60.00000000000000001°。')).toBeNull();
        expect(parseFigureSpec(raw(angleFigure('60.00000000000000001°')), '∠AOB=60°。')).toBeNull();
    });

    it.each(['?', '□', '____', 'x°', '(x+30)°', 'α', '1', '约60°', '60°±1°'])('未知式、角编号和约数 %s 不求解或改写', (label) => {
        expect(parseFigureSpec(raw(angleFigure(label)), '∠AOB=60°。')).toMatchObject({ angles: [{ label }] });
    });

    it.each([
        '∠AOB是否为60°？', '∠AOB为60°吗？', '∠AOB=60°？',
        '∠AOB=60°，这句话对吗？', '∠AOB=60°，判断是否正确。',
        '如果∠AOB=60°。', '若∠AOB=60°。', '假定∠AOB=60°。', '求证∠AOB=60°。',
        '证明∠AOB=60°。', '小明声称∠AOB=60°。', '“∠AOB=60°”。',
        '下列说法：∠AOB=60°。', '∠AOB=60°或120°。', '∠AOB=60°，或者等于120°。',
        'Is angle AOB 60 degrees?', 'angle AOB is not 60 degrees.',
        'If angle AOB is 60 degrees.', 'Prove angle AOB is 60 degrees.',
    ])('不确定、候选和待证明内容不作为已知度数：%s', (question) => {
        expect(parseFigureSpec(raw(angleFigure('120°')), question)).not.toBeNull();
    });

    it.each([
        '2∠AOB=60°。', '2 ∠AOB=60°。', 'x∠AOB=60°。', 'x ∠AOB=60°。',
        '∠AOB=60°+x。', '∠AOB=60°/2。', '∠AOB=60°×2。',
        '∠BOA+∠AOB=60°。', '∠BOA=∠AOB=60°。', '\\frac{1}{2}∠AOB=60°。',
        '∠AOB=60.5°的两倍。',
    ])('不从复合式和系数后截取角度声明：%s', (question) => {
        expect(parseFigureSpec(raw(angleFigure('120°')), question)).not.toBeNull();
    });

    it('只绑定同一顶点，不把另一个顶点的角标注借来比较', () => {
        const spec = angleFigure('120°');
        spec.segments.push({ from: 'first', to: 'second' });
        spec.angles = [{ vertex: 'first', from: 'center', to: 'second', style: 'arc', label: '120°' }];
        expect(parseFigureSpec(raw(spec), '∠AOB=60°。')).not.toBeNull();
    });

    it('隐藏 ID 不能替代可见点名，数字、下标、撇号及大小写保留原始区别', () => {
        const spec = angleFigure('120°');
        spec.points[0]!.label = 'O1';
        spec.points[1]!.label = 'A₁';
        spec.points[2]!.label = 'B′';
        expect(parseFigureSpec(raw(spec), '∠A₁O1B′=60°。')).toBeNull();
        expect(parseFigureSpec(raw(spec), '∠A₁O₁B′=60°。')).toBeNull();
        const unnamed = { ...angleFigure('120°'), points: angleFigure('120°').points.map((point) => ({ ...point, label: undefined })) };
        expect(parseFigureSpec(raw(unnamed), '∠AOB=60°。')).not.toBeNull();
        expect(parseFigureSpec(raw(angleFigure('120°')), '∠aob=60°。')).not.toBeNull();
    });

    it('同一角的所有对应标注均须一致，不能用第一条正确标注遮住冲突', () => {
        const spec = angleFigure('60°');
        spec.angles.push({ vertex: 'center', from: 'second', to: 'first', style: 'arc', label: '120°' });
        expect(parseFigureSpec(raw(spec), '∠AOB=60°。')).toBeNull();
    });

    it('同角的多处明确声明同时核对，不用后文覆盖前文', () => {
        expect(parseFigureSpec(raw(angleFigure('60°')), '∠AOB=60°，∠BOA=120°。')).toBeNull();
        expect(parseFigureSpec(raw(angleFigure('60°')), '∠AOB=60°。∠BOA=120°。')).toBeNull();
    });

    it.each([
        '另一个图中，∠AOB=120°。', '在另一幅图中，∠AOB=120°。',
        'In another diagram, angle AOB measures 120 degrees.', '两个图分别有∠AOB=120°。',
        '∠AOB=120°，在另一幅图中。',
    ])('其它图及未分段多图的同名角不套用到当前图：%s', (question) => {
        expect(parseFigureSpec(raw(angleFigure('60°')), question)).not.toBeNull();
    });

    it('后文的其它图不取消此前已经明确的本图度数', () => {
        for (const separator of ['，', '。']) {
            for (const prefix of ['', '在']) {
                const question = `∠AOB=60°${separator}${prefix}另一幅图中，∠AOB=120°。`;
                expect(parseFigureSpec(raw(angleFigure('60°')), question)).not.toBeNull();
                expect(parseFigureSpec(raw(angleFigure('30°')), question)).toBeNull();
            }
        }
    });

    it('无标注时不补值，但已有直角方框不能冒充60度', () => {
        const plain = { ...angleFigure('60°'), angles: [] };
        expect(parseFigureSpec(raw(plain), '∠AOB=60°。')).not.toBeNull();
        const right = angleFigure('?');
        right.points[2]!.x = right.points[0]!.x;
        right.angles[0]!.style = 'right';
        expect(parseFigureSpec(raw(right), '∠AOB=60°。')).toBeNull();
    });

    it('分段图组只核对各自度数；任一冲突保留完整旧组图', () => {
        const spec = { type: 'figure_group', figures: [
            { label: 'A', figure: angleFigure('60°') }, { label: 'B', figure: angleFigure('120°') },
        ] };
        const question = '图A中，∠AOB=60°；图B中，∠AOB=120°。';
        expect(parseFigureSpec(raw(spec), question)).not.toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧双角图</text></svg>';
        const conflict = question.replace('∠AOB=120°', '∠AOB=30°');
        expect(parseFigureSpec(raw(spec), conflict)).toBeNull();
        expect(parseFigure('true', legacy, raw(spec), conflict)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(spec), conflict)).toEqual({ hasFigure: true, figureSvg: null });
    });
});

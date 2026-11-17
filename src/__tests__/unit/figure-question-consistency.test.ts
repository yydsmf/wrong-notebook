import { describe, expect, it } from 'vitest';
import { parseFigure } from '@/lib/ai/schema';

const raw = (value: unknown) => JSON.stringify(value);
const arithmetic = (top: string, bottom: string, operation: '×' | '+' | '-' | '÷' = '×') => ({
    type: 'vertical_arithmetic', operation, top, bottom,
    partialProducts: operation === '×' ? [{ value: '□□□', shift: 0 }] : [],
});
const area = (shape: 'triangle' | 'rectangle' | 'square' | 'parallelogram' | 'trapezoid') => ({
    type: 'area_geometry', shape, width: 6, height: shape === 'square' ? 6 : 4,
    ...(shape === 'trapezoid' ? { topWidth: 3 } : {}),
});
const solid = (shape: 'cube' | 'cuboid') => ({
    type: 'solid_geometry', shape, width: 4, depth: 4, height: 4,
});
const stackedSolid = (base = { width: 8, depth: 6, height: 4 }, top = { width: 4, depth: 3, height: 3 }) => ({
    type: 'stacked_solid', base, top,
});
const cubeNet = {
    type: 'solid_net', shape: 'cube',
    cells: [
        { row: 0, col: 0 }, { row: -1, col: 0 }, { row: 1, col: 0 },
        { row: 0, col: -1 }, { row: 0, col: 1 }, { row: -2, col: 0 },
    ],
};
const labelledGeometry = (labels: string[], segmentLabels: Array<[string, string]> = []) => ({
    type: 'basic_geometry',
    points: labels.map((label, index) => ({ id: `${label}-${index}`, x: 20 + index * 20, y: index % 2 ? 20 : 80, label })),
    segments: segmentLabels.map(([from, to]) => ({
        from: `${from}-${labels.indexOf(from)}`,
        to: `${to}-${labels.indexOf(to)}`,
    })),
});
const namedTriangle = (apexX: number) => ({
    type: 'basic_geometry',
    points: [
        { id: 'A', x: 20, y: 80, label: 'A' },
        { id: 'B', x: 80, y: 80, label: 'B' },
        { id: 'C', x: apexX, y: 20, label: 'C' },
    ],
    polygons: [{ points: ['A', 'B', 'C'] }],
});
const namedSquare = (bottomY = 80) => ({
    type: 'basic_geometry',
    points: [
        { id: 'A', x: 20, y: 20, label: 'A' },
        { id: 'B', x: 80, y: 20, label: 'B' },
        { id: 'C', x: 80, y: bottomY, label: 'C' },
        { id: 'D', x: 20, y: bottomY, label: 'D' },
    ],
    polygons: [{ points: ['A', 'B', 'C', 'D'] }],
});

describe('题干与结构化配图的一致性', () => {
    it('两位数乘25只约束明确的乘数和位数', () => {
        const question = '观察两位数乘25的乘法竖式，与个位5相乘的积记为甲。';
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '24')), question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(arithmetic('123', '25')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('题干明确写出算式时核对上下顺序和运算符', () => {
        const question = '请列竖式计算 34 × 25。';
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('43', '25')), question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(arithmetic('34', '24')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('题干明确写出除法算式时核对除数和运算符', () => {
        const question = '请列竖式计算 847 ÷ 7。';
        expect(parseFigure('true', null, raw(arithmetic('847', '7', '÷')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('847', '8', '÷')), question)).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(arithmetic('847', '7', '×')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('中文算式、混合单位空格和算式前题号均可核对', () => {
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '20. 竖式计算34乘25。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '竖式计算34乘24。').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '竖式计算34 × 25 = 850。').figureSvg).not.toBeNull();
    });

    it('全角数字、中文乘法和英文位数表达也能用于明确校验', () => {
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '计算３４×２５的竖式。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), 'a two-digit number times 25').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '24')), '两位数与25相乘').figureSvg).toBeNull();
    });

    it('部分积和结果仍由原有结构规则处理，题干不明确时不因故事数字误拦截', () => {
        const story = '小明有34本书，给同学25本后还剩一些，图中用字母表示未知数。';
        expect(parseFigure('true', null, raw(arithmetic('x', 'y')), story).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), '观察竖式，其中个位数字记为甲。').figureSvg).not.toBeNull();
    });

    it('题干只给位数和未知乘数时不要求猜测具体数值', () => {
        const question = '观察三位数乘一个两位数的竖式。';
        expect(parseFigure('true', null, raw(arithmetic('□□□', '□□')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□', '□□')), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('题干列出多个候选算式时不擅自选择其中之一', () => {
        const question = '比较34×25与43×25，哪一个积更大？';
        expect(parseFigure('true', null, raw(arithmetic('34', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('43', '25')), question).figureSvg).not.toBeNull();
    });

    it('题干列出多个不同位数条件时不把它们同时套到一张图', () => {
        const question = '比较两位数乘25和三位数乘25的积。';
        expect(parseFigure('true', null, raw(arithmetic('□□', '25')), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(arithmetic('□□□', '25')), question).figureSvg).not.toBeNull();
    });

    it('旧 SVG 是完整回退，不因结构化条件矛盾而被覆盖', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有竖式</text></svg>';
        const question = '请列竖式计算34×25。';
        expect(parseFigure('true', legacy, raw(arithmetic('43', '25')), question)).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it.each([
        ['正方形题干却返回长方形结构', area('rectangle'), '下图是一个正方形，边长为5厘米。'],
        ['长方形题干却返回三角形结构', area('triangle'), '下图是一个长方形，长为6厘米，宽为4厘米。'],
        ['正方体主图却使用不等长棱', { ...solid('cuboid'), depth: 3, height: 2 }, '下图是一个正方体，棱长是4厘米。'],
        ['三角形主图却返回长方形结构', area('rectangle'), '该图为直角三角形，求面积。'],
        ['英文主图声明却返回错误形状', area('triangle'), 'This diagram is a rectangle. Find its area.'],
        ['英文正方体主图却使用不等长棱', { ...solid('cuboid'), depth: 3, height: 2 }, 'The solid is a cube with an edge of 4 cm.'],
    ])('%s 时拒绝冲突结构', (_name, spec, question) => {
        expect(parseFigure('true', null, raw(spec), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('只接受与题干一致的上下叠放立体', () => {
        expect(parseFigure('true', null, raw(stackedSolid()), '下图是两个长方体上下叠放。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(stackedSolid()), '下图是一个球体。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(stackedSolid({ width: 4, depth: 4, height: 4 }, { width: 3, depth: 3, height: 2 })), '下图是一个正方体，两个物体上下叠放。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(stackedSolid({ width: 4, depth: 4, height: 4 }, { width: 3, depth: 3, height: 3 })), '下图是一个正方体，两个物体上下叠放。').figureSvg).not.toBeNull();
    });

    it('唯一形状与题干一致时保留，题干同时讨论多种形状时不猜测', () => {
        expect(parseFigure('true', null, raw(area('square')), '下图是正方形，求它的面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('trapezoid')), '下图是等腰梯形，求面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cuboid')), '长方体的长宽高分别是4、3、2厘米。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '比较正方形与长方形的面积。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), '求正方形内部三角形的面积。').figureSvg).not.toBeNull();
    });

    it('图组中的各子图不使用整道题的单一形状词逐一误判', () => {
        const group = {
            type: 'figure_group',
            figures: [
                { label: '甲', figure: area('square') },
                { label: '乙', figure: area('triangle') },
            ],
        };
        expect(parseFigure('true', null, raw(group), '比较正方形和三角形的面积。').figureSvg).not.toBeNull();
    });

    it('明确按选项标签分段时校验每张子图的具名线段归属', () => {
        const question = 'A. 连接AB；B. 连接CD。';
        const valid = {
            type: 'figure_group',
            figures: [
                { label: 'A', figure: labelledGeometry(['A', 'B'], [['A', 'B']]) },
                { label: 'B', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
            ],
        };
        expect(parseFigure('true', null, raw(valid), question).figureSvg).not.toBeNull();

        const missingLine = {
            ...valid,
            figures: [
                { label: 'A', figure: labelledGeometry(['A', 'B']) },
                valid.figures[1],
            ],
        };
        expect(parseFigure('true', null, raw(missingLine), question)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('兼容图A中、选项B和括号选项等常见分段写法', () => {
        const group = {
            type: 'figure_group',
            figures: [
                { label: 'A', figure: labelledGeometry(['A', 'B'], [['A', 'B']]) },
                { label: 'B', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
            ],
        };
        for (const question of ['图A中：连接AB；图B中：连接CD。', '选项A：连接AB；选项B：连接CD。', '(A) 连接AB；(B) 连接CD。']) {
            expect(parseFigure('true', null, raw(group), question).figureSvg).not.toBeNull();
        }
        const mismatch = { ...group, figures: [{ label: 'A', figure: labelledGeometry(['A', 'B']) }, group.figures[1]] };
        expect(parseFigure('true', null, raw(mismatch), '选项A：连接AB；选项B：连接CD。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('选项内所有具名点都缺失时也回退，未明确归属的图组仍保守通过', () => {
        const group = {
            type: 'figure_group',
            figures: [
                { label: 'A', figure: labelledGeometry(['X', 'Y'], [['X', 'Y']]) },
                { label: 'B', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
            ],
        };
        expect(parseFigure('true', null, raw(group), 'A. 连接AB；B. 连接CD。')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(group), '比较图A和图B中的线段长度。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(group), '判断正误：A中的AB是线段；B中的CD是线段。').figureSvg).not.toBeNull();
    });

    it('明确标记的选项形状分别校验，不把多个形状词套到所有子图', () => {
        const group = {
            type: 'figure_group',
            figures: [
                { label: '甲', figure: area('square') },
                { label: '乙', figure: area('triangle') },
            ],
        };
        expect(parseFigure('true', null, raw(group), '甲. 下图是正方形；乙. 下图是三角形。').figureSvg).not.toBeNull();
        const mismatch = { ...group, figures: [{ label: '甲', figure: area('rectangle') }, group.figures[1]] };
        expect(parseFigure('true', null, raw(mismatch), '甲. 下图是正方形；乙. 下图是三角形。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('逐选项校验圆图和竖式条件，点名或算式必须属于对应子图', () => {
        const circle = (pointNames: string[], radii: string[] = []) => ({
            type: 'circle_geometry',
            center: { id: 'O', x: 50, y: 50, label: 'O' },
            radius: 30,
            points: pointNames.map((label, index) => ({
                id: label, label, x: index === 0 ? 80 : 50, y: index === 0 ? 50 : 20,
            })),
            radii: radii.map((to) => ({ to })),
            chords: [{ from: pointNames[0]!, to: pointNames[1]! }],
        });
        const circleGroup = {
            type: 'figure_group',
            figures: [
                { label: '甲', figure: circle(['A', 'B'], ['A']) },
                { label: '乙', figure: circle(['C', 'D']) },
            ],
        };
        expect(parseFigure('true', null, raw(circleGroup), '图甲中：半径OA；图乙中：弦CD。').figureSvg).not.toBeNull();
        const missingRadius = { ...circleGroup, figures: [{ label: '甲', figure: circle(['A', 'B']) }, circleGroup.figures[1]] };
        expect(parseFigure('true', null, raw(missingRadius), '图甲中：半径OA；图乙中：弦CD。')).toEqual({ hasFigure: true, figureSvg: null });

        const arithmeticGroup = {
            type: 'figure_group',
            figures: [
                { label: '甲', figure: arithmetic('34', '25') },
                { label: '乙', figure: arithmetic('43', '25') },
            ],
        };
        expect(parseFigure('true', null, raw(arithmeticGroup), '甲. 竖式计算34×25；乙. 竖式计算43×25。').figureSvg).not.toBeNull();
        const wrongOperand = { ...arithmeticGroup, figures: [{ label: '甲', figure: arithmetic('43', '25') }, arithmeticGroup.figures[1]] };
        expect(parseFigure('true', null, raw(wrongOperand), '甲. 竖式计算34×25；乙. 竖式计算43×25。')).toEqual({ hasFigure: true, figureSvg: null });
    });

    describe('图组子句的分段边界', () => {
        const valid = {
            type: 'figure_group',
            figures: [
                { label: 'A', figure: labelledGeometry(['A', 'B'], [['A', 'B']]) },
                { label: 'B', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
            ],
        };
        const missingLine = {
            ...valid,
            figures: [{ label: 'A', figure: labelledGeometry(['A', 'B']) }, valid.figures[1]],
        };

        it.each([
            '图A中连接AB；图B中连接CD。',
            '(A)连接AB；(B)连接CD。',
            '（Ａ）连接AB\n（Ｂ）连接CD。',
            'Figure A: 连接AB; Figure B: 连接CD.',
            'Option A: 连接AB; Option B: 连接CD.',
            'B. 连接CD；A. 连接AB。',
        ])('明确分段同时验证正确接受和漏线拒绝：%s', (question) => {
            expect(parseFigure('true', null, raw(valid), question).figureSvg).not.toBeNull();
            expect(parseFigure('true', null, raw(missingLine), question)).toEqual({ hasFigure: true, figureSvg: null });
        });

        it.each([
            '比较图A和图B中的线段长度。',
            'A. 连接AB。',
            'A. 连接AB；A. 连接AB；B. 连接CD。',
            'A. 连接AB；B.',
            '下列哪项正确？A. 连接AB；B. 连接CD。',
            '判断正误。A. 连接AB；B. 连接CD。',
            'Which option is correct? A. 连接AB; B. 连接CD.',
            'A. 若连接AB；B. 连接CD。',
            'A. “连接AB”；B. 连接CD。',
        ])('归属不完整或待判断表述保守跳过：%s', (question) => {
            expect(parseFigure('true', null, raw(missingLine), question).figureSvg).not.toBeNull();
        });

        it('子图标签与几何点名重合时，不把点名句误当作选项分段', () => {
            const pointsNamedAcrossFigures = {
                ...valid,
                figures: [
                    { label: 'A', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
                    { label: 'B', figure: labelledGeometry(['A', 'B'], [['A', 'B']]) },
                ],
            };
            const question = 'A is a point; line AB; B is a point; line CD.';
            expect(parseFigure('true', null, raw(pointsNamedAcrossFigures), question).figureSvg).not.toBeNull();
        });

        it('非点名型中文标签仍兼容空格分段', () => {
            const group = {
                type: 'figure_group',
                figures: [
                    { label: '甲', figure: labelledGeometry(['A', 'B'], [['A', 'B']]) },
                    { label: '乙', figure: labelledGeometry(['C', 'D'], [['C', 'D']]) },
                ],
            };
            const missingLine = { ...group, figures: [{ label: '甲', figure: labelledGeometry(['A', 'B']) }, group.figures[1]] };
            const question = '甲 连接AB；乙 连接CD。';
            expect(parseFigure('true', null, raw(group), question).figureSvg).not.toBeNull();
            expect(parseFigure('true', null, raw(missingLine), question).figureSvg).toBeNull();
        });

        it('图组冲突仍返回完整旧SVG，不改写输入结构或只保留成功子图', () => {
            const before = raw(missingLine);
            const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整图组</text></svg>';
            expect(parseFigure('true', legacy, before, 'A. 连接AB；B. 连接CD。'))
                .toEqual({ hasFigure: true, figureSvg: legacy });
            expect(raw(missingLine)).toBe(before);
        });
    });

    it('形状冲突时优先保留完整旧 SVG', () => {
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有图形</text></svg>';
        expect(parseFigure('true', legacy, raw(area('rectangle')), '下图是一个正方形。')).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('英文形状词可核对，嵌套图形或否定句保持保守', () => {
        expect(parseFigure('true', null, raw(area('square')), 'Find the area of a square.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'The figure is a rectangle. Find its area.').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(solid('cube')), 'A cube has edge length 4 cm.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'Find the area of a triangle inside a square.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'It is not a square; it is a rectangle.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'The area is 12 square centimeters.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'Find the square root of 16.').figureSvg).not.toBeNull();
    });

    it('直接指代主图的中英文形状声明也执行结构校验', () => {
        expect(parseFigure('true', null, raw(area('square')), '这是一个正方形，面积是多少？').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '这是一个正方形，面积是多少？')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(area('square')), 'This is a square. Find its area.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), 'This is a square. Find its area.')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(area('rectangle')), 'This is a square?').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '这是一个正方形？').figureSvg).not.toBeNull();
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有形状图</text></svg>';
        expect(parseFigure('true', legacy, raw(area('rectangle')), 'This is a square. Find its area.'))
            .toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('具名三角形和四边形声明也核对结构、特征和点名', () => {
        const validTriangle = namedTriangle(50);
        const invalidTriangle = namedTriangle(65);
        for (const question of [
            '三角形ABC是等腰三角形。',
            '△ABC为等腰三角形。',
            'Triangle ABC is an isosceles triangle.',
        ]) {
            expect(parseFigure('true', null, raw(validTriangle), question).figureSvg, question).not.toBeNull();
            expect(parseFigure('true', null, raw(invalidTriangle), question), question)
                .toEqual({ hasFigure: true, figureSvg: null });
        }

        for (const question of ['四边形ABCD是正方形。', 'ABCD为正方形。', 'Quadrilateral ABCD is a square.']) {
            expect(parseFigure('true', null, raw(namedSquare()), question).figureSvg, question).not.toBeNull();
            expect(parseFigure('true', null, raw(namedSquare(70)), question), question)
                .toEqual({ hasFigure: true, figureSvg: null });
        }

        expect(parseFigure('true', null, raw(namedSquare()), '四边形ABCE是正方形。'))
            .toEqual({ hasFigure: true, figureSvg: null });
    });

    it.each([
        ['长方形', 'rectangle', [[20, 30], [80, 30], [80, 70], [20, 70]]],
        ['平行四边形', 'parallelogram', [[35, 20], [85, 20], [65, 75], [15, 75]]],
        ['梯形', 'trapezoid', [[35, 20], [65, 20], [85, 75], [15, 75]]],
    ])('具名%s的中英文声明均校验对应形状', (name, english, coordinates) => {
        const valid = namedSquare();
        const invalid = namedSquare();
        const invalidCoordinates = [[20, 20], [75, 25], [80, 80], [20, 80]];
        valid.points.forEach((point, index) => {
            [point.x, point.y] = coordinates[index]!;
            [invalid.points[index]!.x, invalid.points[index]!.y] = invalidCoordinates[index]!;
        });
        for (const question of [`四边形ABCD是${name}。`, `ABCD为${name}。`, `Quadrilateral ABCD is a ${english}.`]) {
            expect(parseFigure('true', null, raw(valid), question).figureSvg, question).not.toBeNull();
            expect(parseFigure('true', null, raw(invalid), question), question)
                .toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it('具名等边声明校验边长，不把等腰三角形当作等边', () => {
        const equilateral = namedTriangle(50);
        equilateral.points[2]!.y = 80 - 30 * Math.sqrt(3);
        for (const question of ['三角形ABC为等边三角形。', 'Triangle ABC is an equilateral triangle.']) {
            expect(parseFigure('true', null, raw(equilateral), question).figureSvg, question).not.toBeNull();
            expect(parseFigure('true', null, raw(namedTriangle(50)), question), question)
                .toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it('具名形状的疑问、假设和判断语境仍保守跳过', () => {
        const invalidTriangle = raw(namedTriangle(65));
        for (const question of [
            '三角形ABC是等腰三角形吗？',
            '如果三角形ABC是等腰三角形，求面积。',
            '判断三角形ABC是否为等腰三角形。',
            '三角形ABC是等腰三角形，这个说法正确吗？',
            '三角形ABC是等腰三角形。请判断这个说法。',
            '三角形ABC是等腰三角形，若它有两条等边。',
            '“三角形ABC是等腰三角形”。',
            "'三角形ABC是等腰三角形'。",
            'Triangle ABC is an isosceles triangle. True or false?',
            'Triangle ABC is an isosceles triangle, if two sides are equal.',
            "'Triangle ABC is an isosceles triangle'.",
            '下列说法中正确的是：三角形ABC是等腰三角形。',
            '选择正确的说法：三角形ABC是等腰三角形。',
            '正误题：三角形ABC是等腰三角形。',
            'Select the correct statement. Triangle ABC is an isosceles triangle.',
        ]) {
            expect(parseFigure('true', null, invalidTriangle, question).figureSvg, question).not.toBeNull();
        }
    });

    it('具名声明按可见点名对应，不混用隐藏ID或不同大小写的点名', () => {
        const question = '三角形ABC是等腰三角形。';
        for (const labels of [['X', 'Y', 'Z'], ['a', 'B', 'C'], [undefined, undefined, undefined]]) {
            const spec = namedTriangle(50);
            const points = spec.points.map((point, index) => ({ ...point, label: labels[index] }));
            expect(parseFigure('true', null, raw({ ...spec, points }), question))
                .toEqual({ hasFigure: true, figureSvg: null });
        }

        const spec = namedTriangle(50);
        const points = spec.points.map((point) => ({ ...point, id: `internal-${point.id}` }));
        const polygons = [{ points: ['internal-A', 'internal-B', 'internal-C'] }];
        expect(parseFigure('true', null, raw({ ...spec, points, polygons }), question).figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(spec), '三角形PQR为等腰三角形。'))
            .toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(spec), '三角形ＡＢＣ为等腰三角形。').figureSvg).not.toBeNull();
        spec.points[0]!.label = 'a';
        expect(parseFigure('true', null, raw(spec), '三角形aBC为等腰三角形。').figureSvg).not.toBeNull();
    });

    it('英文直接指代句中的常见词不误识别为四边形点名', () => {
        for (const question of ['This is a square. Find its area.', 'That is a square.', 'The figure is a square.']) {
            expect(parseFigure('true', null, raw(area('square')), question).figureSvg, question).not.toBeNull();
        }
    });

    it('具名四边形须对应主图边界顺序，允许循环和反向但拒绝交叉点名', () => {
        const spec = raw(namedSquare());
        for (const names of ['ABCD', 'BCDA', 'CDAB', 'DABC', 'DCBA', 'CBAD', 'BADC', 'ADCB']) {
            expect(parseFigure('true', null, spec, `四边形${names}是正方形。`).figureSvg, names).not.toBeNull();
        }
        for (const names of ['ACBD', 'ABDC', 'ACDB']) {
            expect(parseFigure('true', null, spec, `四边形${names}是正方形。`), names)
                .toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it('图中存在同名内部点不能代替声明中的多边形顶点', () => {
        const spec = namedSquare();
        spec.points[2].label = 'E';
        spec.points.push({ id: 'inside', x: 50, y: 50, label: 'C' });
        expect(parseFigure('true', null, raw(spec), '四边形ABCD是正方形。'))
            .toEqual({ hasFigure: true, figureSvg: null });
    });

    it('具名主图保留共线中间点，并支持唯一实线闭合环', () => {
        const spec = namedSquare();
        spec.points.push({ id: 'E', x: 50, y: 20, label: 'E' });
        spec.polygons[0].points = ['A', 'E', 'B', 'C', 'D'];
        expect(parseFigure('true', null, raw(spec), '四边形ABCD是正方形。').figureSvg).not.toBeNull();

        const triangle = namedTriangle(65);
        const segments = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }];
        expect(parseFigure('true', null, raw({ ...triangle, polygons: [], segments }), '三角形ABC是等腰三角形。'))
            .toEqual({ hasFigure: true, figureSvg: null });
    });

    it('英文具名直角声明核对三角形特征', () => {
        const right = raw(namedTriangle(20));
        const scalene = raw(namedTriangle(65));
        for (const description of ['right triangle', 'right-angled triangle', 'right angled triangle', 'right isosceles triangle']) {
            const question = `Triangle ABC is a ${description}.`;
            expect(parseFigure('true', null, right, question).figureSvg, question).not.toBeNull();
            expect(parseFigure('true', null, scalene, question), question).toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it('不把更长点名串的后四个字母或另一种形状强行对应成具名主图', () => {
        const spec = raw(namedSquare(70));
        for (const question of [
            'XABCD是正方形。',
            'E A B C D是正方形。',
            "A'ABCD为正方形。",
            'ABCD为正方形，比较它和另一个长方形的面积。',
        ]) {
            expect(parseFigure('true', null, spec, question).figureSvg, question).not.toBeNull();
        }
    });

    it('具名形状冲突保留完整旧SVG且不改写输入结构', () => {
        const spec = namedTriangle(65);
        const before = raw(spec);
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原配图</text></svg>';
        expect(parseFigure('true', legacy, before, '三角形ABC是等腰三角形。'))
            .toEqual({ hasFigure: true, figureSvg: legacy });
        expect(raw(spec)).toBe(before);
    });

    it('具名图形的子图归属按图组标签隔离，冲突时保留整组旧图', () => {
        const group = {
            type: 'figure_group', figures: [
                { label: '甲', figure: namedTriangle(50) },
                { label: '乙', figure: namedTriangle(65) },
            ],
        };
        const question = '图甲中：三角形ABC是等腰三角形；图乙中：三角形ABC是等腰三角形。';
        expect(parseFigure('true', null, raw(group), question)).toEqual({ hasFigure: true, figureSvg: null });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整原图组</text></svg>';
        expect(parseFigure('true', legacy, raw(group), question)).toEqual({ hasFigure: true, figureSvg: legacy });
        group.figures[1]!.figure = namedTriangle(50);
        expect(parseFigure('true', null, raw(group), question).figureSvg).not.toBeNull();
    });

    it('具名声明不把复合图强行简化成单个主图', () => {
        const spec = namedSquare(70);
        spec.polygons.push({ points: ['A', 'B', 'C'] });
        expect(parseFigure('true', null, raw(spec), '四边形ABCD是正方形。').figureSvg).not.toBeNull();
    });

    it('没有可见点名的面积、立体和坐标模板不冒充具名主图', () => {
        const question = '三角形ABC是等腰三角形。';
        expect(parseFigure('true', null, raw(area('triangle')), question))
            .toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(solid('cuboid')), '四边形ABCD是正方形。'))
            .toEqual({ hasFigure: true, figureSvg: null });
        const coordinate = {
            type: 'coordinate_plane', xMin: 0, xMax: 10, yMin: 0, yMax: 10, xStep: 1, yStep: 1,
            points: [], segments: [], labels: [],
        };
        expect(parseFigure('true', null, raw(coordinate), question))
            .toEqual({ hasFigure: true, figureSvg: null });
    });

    it.each([
        [area('square'), '一个正方体的底面如下图，求底面积。'],
        [area('rectangle'), '这不是一个正方形，请观察形状。'],
        [area('rectangle'), '下图是一个正方形吗？'],
        [area('triangle'), '下图是一个正方形，求阴影部分的面积。'],
        [area('rectangle'), 'The area is 12 square kilometers.'],
        [area('rectangle'), 'The figure is not a square.'],
        [area('triangle'), 'The figure is a square. Find the shaded area.'],
    ])('局部图、形状判断和非形状单词不限制主图模板：%s / %s', (spec, question) => {
        expect(parseFigure('true', null, raw(spec), question).figureSvg).not.toBeNull();
    });

    it('兼容模板画出的正方形和正方体不因类型名称不同而回退', () => {
        const squareRectangle = { ...area('rectangle'), width: 6, height: 6 };
        expect(parseFigure('true', null, raw(squareRectangle), '下图是一个正方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('square')), '下图是一个长方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('rectangle')), '下图是一个平行四边形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('parallelogram')), '下图是一个长方形。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cuboid')), '下图是一个正方体。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(solid('cube')), '下图是一个长方体。').figureSvg).not.toBeNull();
    });

    it('明确长方体展开图时拒绝正方体展开图，待判断展开图保持保守', () => {
        expect(parseFigure('true', null, raw(cubeNet), '下图是正方体的展开图。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(cubeNet), '下图是长方体的展开图。'))
            .toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(cubeNet), '下图是一个 cuboid net。'))
            .toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('true', null, raw(cubeNet), '哪些展开图能折成正方体？').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(cubeNet), '下图是正方体还是长方体的展开图？').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(cubeNet), '题干引用“长方体的展开图”这句话。').figureSvg).not.toBeNull();
    });

    it('兼容模板仍需满足明确主图的长度标注，不改写单位或补充未知值', () => {
        const squareRectangle = { ...area('rectangle'), width: 6, height: 6 };
        const unequalLabels = { ...squareRectangle, baseLabel: '5cm', heightLabel: '6cm' };
        const unequalEdges = { ...solid('cuboid'), widthLabel: '5cm', heightLabel: '6cm' };
        expect(parseFigure('true', null, raw(unequalLabels), '下图是一个正方形。').figureSvg).toBeNull();
        expect(parseFigure('true', null, raw(unequalEdges), '下图是一个正方体。').figureSvg).toBeNull();
        const metricLabels = { ...squareRectangle, baseLabel: '1分米', heightLabel: '10cm' };
        const svg = parseFigure('true', null, raw(metricLabels), '下图是一个正方形。').figureSvg;
        expect(svg).toContain('1分米');
        expect(svg).toContain('10cm');
    });

    it('没有主图声明时不把故事对象当成配图约束', () => {
        expect(parseFigure('true', null, raw(area('triangle')), '工人用正方形纸张制作了一面旗帜。').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'Find the area in square units.').figureSvg).not.toBeNull();
        expect(parseFigure('true', null, raw(area('triangle')), 'A square sheet is used to make a flag.').figureSvg).not.toBeNull();
    });
});

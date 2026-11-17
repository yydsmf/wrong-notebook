import { describe, expect, it } from 'vitest';
import { ARITHMETIC_FIGURE_FIXTURES } from '@/__tests__/fixtures/figure-arithmetic-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { FIGURE_SPEC_RULES } from '@/lib/ai/prompts';
import { parseFigureSpec, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const multiplication = {
    type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '25',
    partialProducts: [{ value: '170', label: '甲' }, { value: '68', label: '乙' }], result: '850',
};
const raw = (value: unknown) => JSON.stringify(value);

describe('竖式中的作答空格和数位关系', () => {
    it.each(ARITHMETIC_FIGURE_FIXTURES.filter(({ initialVisible }) => initialVisible))('$id 初始手机阅读不被外围留白占满', ({ spec }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const root = new DOMParser().parseFromString(svg!, 'image/svg+xml').documentElement;
        expect(Number(root.getAttribute('width'))).toBeLessThanOrEqual(260);
        expect(Number(root.getAttribute('height'))).toBeLessThan(450);
    });

    it('每个数字和方框使用同一个数位间距，不靠字体字宽对齐', () => {
        const document = new DOMParser().parseFromString(renderFigureSpec(raw(ARITHMETIC_FIGURE_FIXTURES[0].spec))!, 'image/svg+xml');
        const top = document.querySelector('text[data-arithmetic-row="top"]')!;
        const partials = Array.from(document.querySelectorAll('text[data-arithmetic-row="partial"]'));
        expect(top).not.toBeNull();
        expect(partials).toHaveLength(2);
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/).map(Number);
        const unit = positions(top).at(-1)!;
        const step = positions(top)[1] - positions(top)[0];
        expect(step).toBeGreaterThanOrEqual(28);
        for (const element of [top, ...partials]) {
            const values = positions(element);
            expect(values).toHaveLength(element.textContent!.length);
            for (let index = 1; index < values.length; index += 1) expect(values[index] - values[index - 1]).toBe(step);
        }
        expect(positions(partials[0]).at(-1)).toBe(unit);
        expect(positions(partials[1]).at(-1)).toBe(unit - step);
    });

    it('多行竖式的说明在完整结果下方，不能固定在中间压住部分积', () => {
        const spec = {
            ...multiplication, top: '12345678', bottom: '87654321',
            partialProducts: Array.from({ length: 8 }, (_, shift) => ({ value: '1', label: `积${shift + 1}`, shift })),
            result: '1', note: '比较每一行部分积并说明数位关系',
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const texts = Array.from(document.querySelectorAll('text'));
        const note = texts.find((element) => element.textContent === spec.note)!;
        const result = texts.find((element) => element.textContent === '1082152022374638')!;
        expect(Number(note.getAttribute('y'))).toBeGreaterThan(Number(result.getAttribute('y')) + 24);
        expect(Number(document.documentElement.getAttribute('height'))).toBeLessThanOrEqual(800);
    });

    it('无法完整排版的长说明回退，不能压成小字或漏字', () => {
        const spec = raw({ ...multiplication, note: '1'.repeat(60) });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('数位与完整标签超出画布时不缩小字或截字，整图和整组均回退', () => {
        const figure = {
            type: 'vertical_arithmetic', operation: '×', top: 'a'.repeat(18), bottom: '25',
            partialProducts: [{ value: 'b'.repeat(18), label: '甲'.repeat(12), shift: 1 }],
        };
        const group = { type: 'figure_group', figures: [{ label: 'A', figure: multiplication }, { label: 'B', figure }] };
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧配图</text></svg>';
        for (const spec of [figure, group]) {
            expect(parseFigureSpec(raw(spec))).not.toBeNull();
            expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
            expect(parseFigure('true', legacy, raw(spec))).toEqual({ hasFigure: true, figureSvg: legacy });
            expect(parseFigure('true', null, raw(spec))).toEqual({ hasFigure: true, figureSvg: null });
        }
    });

    it.each(ARITHMETIC_FIGURE_FIXTURES)('$id 保留完整题图和确定输出', ({ spec, mustContain, mustHaveText }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        expect(renderFigureSpec(raw(spec))).toBe(svg);
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        for (const value of mustContain) expect(svg).toContain(value);
        const texts = Array.from(document.querySelectorAll('text'), (element) => element.textContent);
        for (const value of mustHaveText ?? []) expect(texts).toContain(value);
    });

    it.each(['□', '□□□', '___', '?', '1□0', 'a70', '( )', '34 × 5'])(
        '已知两个因数也不把部分积中的 %s 改成答案', (value) => {
            const spec = { ...multiplication, partialProducts: [{ value, label: '甲' }, { value: '68', label: '乙' }] };
            expect(parseFigureSpec(raw(spec))).toMatchObject({
                partialProducts: [{ value, label: '甲', shift: 0 }, { value: '68', label: '乙', shift: 1 }],
            });
            expect(renderFigureSpec(raw(spec))).toContain(`>${value}</text>`);
        },
    );

    it.each(['×', '+', '-'])('%s 的结果空格不能被自动计算填满', (operation) => {
        const spec = { ...multiplication, operation, partialProducts: [], result: '□□□' };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ result: '□□□' });
        expect(renderFigureSpec(raw(spec))).toContain('>□□□</text>');
    });

    it('全角数字和问号规范化后仍保留作答状态，不补全缺少的结果', () => {
        const spec = { ...multiplication, top: '３４', bottom: '２５', partialProducts: [{ value: '？' }], result: '？' };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ top: '34', bottom: '25', partialProducts: [{ value: '?', shift: 0 }], result: '?' });
        const parsed = parseFigureSpec(raw({ ...spec, result: undefined }));
        expect(parsed).not.toHaveProperty('result');
    });

    it('显式正号和全角符号不计入数位，仍能精确复算乘法部分积和结果', () => {
        const parsed = parseFigureSpec(raw({
            ...multiplication,
            top: '＋３４',
            bottom: '＋２５',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '999',
        }));
        expect(parsed).toMatchObject({
            top: '+34',
            bottom: '+25',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '850',
        });
        expect(renderFigureSpec(raw({
            ...multiplication,
            top: '＋３４',
            bottom: '＋２５',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '999',
        }))).toContain('>+34</text>');
    });

    it('Unicode 负号参与整数复算，但保留题面符号', () => {
        const parsed = parseFigureSpec(raw({
            ...multiplication,
            top: '−34',
            bottom: '+25',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '999',
        }));
        expect(parsed).toMatchObject({
            top: '−34',
            bottom: '+25',
            partialProducts: [{ value: '-170', shift: 0 }, { value: '-68', shift: 1 }],
            result: '-850',
        });
    });

    it('负号乘数的部分积符号与复算结果保持一致', () => {
        const parsed = parseFigureSpec(raw({
            ...multiplication,
            top: '34',
            bottom: '−25',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }],
            result: '999',
        }));
        expect(parsed).toMatchObject({
            top: '34',
            bottom: '−25',
            partialProducts: [{ value: '-170', shift: 0 }, { value: '-68', shift: 1 }],
            result: '-850',
        });
    });

    it('加减小数竖式按小数点对齐，整数行也对齐到个位', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '+', top: '12.3', bottom: '4', result: '16.3',
            partialProducts: [],
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Object.fromEntries(Array.from(document.querySelectorAll('text[data-arithmetic-row]'))
            .map((element) => [element.getAttribute('data-arithmetic-row'), element]));
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/u).map(Number);
        const decimalPosition = (element: Element) => positions(element)[element.textContent!.indexOf('.')];
        const unitsPosition = (element: Element) => {
            const separator = element.textContent!.indexOf('.');
            return positions(element)[separator < 0 ? element.textContent!.length - 1 : separator - 1];
        };
        expect(decimalPosition(rows.top!)).toBe(decimalPosition(rows.result!));
        expect(unitsPosition(rows.top!)).toBe(unitsPosition(rows.bottom!));
        expect(unitsPosition(rows.top!)).toBe(unitsPosition(rows.result!));
        expect(decimalPosition(rows.top!) - unitsPosition(rows.bottom!)).toBe(30);
    });

    it('加减小数竖式支持不同小数位数的数字行', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '+', top: '12.30', bottom: '4.56', result: '16.86',
            partialProducts: [],
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Object.fromEntries(Array.from(document.querySelectorAll('text[data-arithmetic-row]'))
            .map((element) => [element.getAttribute('data-arithmetic-row'), element]));
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/u).map(Number);
        const decimalPosition = (element: Element) => positions(element)[element.textContent!.indexOf('.')];
        expect(decimalPosition(rows.top!)).toBe(decimalPosition(rows.bottom!));
        expect(decimalPosition(rows.top!)).toBe(decimalPosition(rows.result!));
    });

    it('加减小数竖式保留未知方框，并不把小数点当成普通末尾对齐字符', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '-', top: '□.50', bottom: '1.2', result: '□.30',
            partialProducts: [],
        };
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row]'));
        const byText = new Map(rows.map((element) => [element.textContent, element]));
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/u).map(Number);
        const decimalPosition = (element: Element) => positions(element)[element.textContent!.indexOf('.')];
        expect(decimalPosition(byText.get('□.50')!)).toBe(decimalPosition(byText.get('1.2')!));
        expect(decimalPosition(byText.get('□.50')!)).toBe(decimalPosition(byText.get('□.30')!));
    });

    it('含字母表达式时不误用小数点网格', () => {
        const svg = renderFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '+', top: 'a.2', bottom: '1.3', result: 'b.5', partialProducts: [],
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const top = document.querySelector('text[data-arithmetic-row="top"]')!;
        expect(top.getAttribute('x')!.trim().split(/\s+/u)).toHaveLength(1);
    });

    it('存在部分积时不误用小数加减网格', () => {
        const svg = renderFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '+', top: '12.3', bottom: '4.56',
            partialProducts: [{ value: '16.86', shift: 0 }], result: '16.86',
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const top = document.querySelector('text[data-arithmetic-row="top"]')!;
        expect(top.getAttribute('x')!.trim().split(/\s+/u)).toHaveLength(1);
    });

    it.each(ARITHMETIC_FIGURE_FIXTURES.filter(({ id }) => id.startsWith('multiplication-decimal-')))('$id 按末位数字对齐，小数点不占整列', ({ spec }) => {
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row]'));
        const positions = (element: Element) => element.getAttribute('x')!.split(/\s+/u).map(Number);
        const top = rows.find((element) => element.getAttribute('data-arithmetic-row') === 'top')!;
        const unit = positions(top).at(-1)!;
        const partials = rows.filter((element) => element.getAttribute('data-arithmetic-row') === 'partial');
        const source = spec as { top: string; bottom: string; result: string; partialProducts: Array<{ value: string; shift: number }> };
        expect(rows.map((element) => element.textContent)).toEqual([
            source.top, source.bottom, ...source.partialProducts.map(({ value }) => value), source.result,
        ]);
        for (const row of rows) {
            const characters = Array.from(row.textContent!);
            const anchors = positions(row);
            expect(anchors).toHaveLength(characters.length);
            expect(row.getAttribute('text-anchor')).toBe('middle');
            for (let index = 1; index < characters.length; index += 1) {
                const gap = characters[index] === '.' || characters[index - 1] === '.' ? 15 : 30;
                expect(anchors[index] - anchors[index - 1]).toBe(gap);
            }
            if (row.getAttribute('data-arithmetic-row') !== 'partial') expect(anchors.at(-1)).toBe(unit);
        }
        partials.forEach((row, index) => expect(unit - positions(row).at(-1)!).toBe(source.partialProducts[index].shift * 30));
    });

    it('小数乘法不误用加减的小数点对齐，也不删除末尾零', () => {
        const svg = renderFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '×', top: '1.20', bottom: '0.35', result: '0.4200',
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row]'));
        const decimal = (row: Element) => row.getAttribute('x')!.split(/\s+/u).map(Number)[row.textContent!.indexOf('.')];
        expect(rows.map((row) => row.textContent)).toEqual(['1.20', '0.35', '0.4200']);
        expect(decimal(rows[0])).toBe(decimal(rows[1]));
        expect(decimal(rows[0]) - decimal(rows[2])).toBe(60);
    });

    it('小数乘法保留显式符号与题面已有结果，不静默复算', () => {
        const spec = {
            type: 'vertical_arithmetic', operation: '×', top: '＋３.４', bottom: '−２.５',
            partialProducts: [{ value: '-170', shift: 0 }, { value: '-68', shift: 1 }], result: '-9.99',
        };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ top: '+3.4', bottom: '−2.5', result: '-9.99', partialProducts: spec.partialProducts });
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row]'));
        for (const row of rows) expect(row.getAttribute('x')!.split(/\s+/u)).toHaveLength(row.textContent!.length);
        expect(rows.map((row) => row.textContent)).toEqual(['+3.4', '−2.5', '-170', '-68', '-9.99']);
    });

    it.each(['2.5', '−2.5', '＋２.５', '□.5'])('小数乘数 %s 的小数点和符号不计入部分积位数', (bottom) => {
        const invalid = raw({
            type: 'vertical_arithmetic', operation: '×', top: '3.4', bottom,
            partialProducts: [{ value: '□□', shift: 2 }],
        });
        expect(renderFigureSpecDetailed(invalid)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>保留原配图</text></svg>';
        expect(parseFigure('true', legacy, invalid)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, invalid)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('小数未知量不补出缺少的部分积或结果', () => {
        const spec = { type: 'vertical_arithmetic', operation: '×', top: '□.4', bottom: '2.5' };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ top: '□.4', bottom: '2.5', partialProducts: [] });
        expect(parseFigureSpec(raw(spec))).not.toHaveProperty('result');
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(Array.from(document.querySelectorAll('text[data-arithmetic-row]'), (element) => element.textContent)).toEqual(['□.4', '2.5']);
    });

    it.each(['a.2', '1..2', '(1.2)'])('乘法中的不明确字符 %s 继续使用原有整行布局', (top) => {
        const svg = renderFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '×', top, bottom: '2.5', result: '□.0',
        }));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const row = document.querySelector('text[data-arithmetic-row="top"]')!;
        expect(row.textContent).toBe(top);
        expect(row.getAttribute('x')!.trim().split(/\s+/u)).toHaveLength(1);
        expect(row.getAttribute('text-anchor')).toBe('end');
    });

    it('小数乘法的超宽列和标签仍整图回退，不挤压字形', () => {
        const figure = {
            type: 'vertical_arithmetic', operation: '×', top: '1.2', bottom: '1.234567890',
            partialProducts: [{ value: '1.2345678901234567', shift: 8, label: '甲'.repeat(12) }],
        };
        expect(parseFigureSpec(raw(figure))).not.toBeNull();
        expect(renderFigureSpecDetailed(raw(figure))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>完整旧配图</text></svg>';
        expect(parseFigure('true', legacy, raw(figure))).toEqual({ hasFigure: true, figureSvg: legacy });
    });

    it('带正号的整数长除法仍按真实被除数位数校验逐步减数', () => {
        const parsed = parseFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '＋847', bottom: '＋7',
            divisionSteps: [
                { value: '8', subtract: '7', shift: 2 }, { value: '14', subtract: '14', shift: 1 }, { value: '7', subtract: '7', shift: 0 },
            ], result: '999',
        }));
        expect(parsed).toMatchObject({ top: '+847', bottom: '+7', result: '121' });
        expect(renderFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '＋847', bottom: '＋7',
            divisionSteps: [
                { value: '8', subtract: '7', shift: 2 }, { value: '14', subtract: '14', shift: 1 }, { value: '7', subtract: '7', shift: 0 },
            ], result: '999',
        }))).not.toBeNull();
    });

    it('未知被乘数也按每行默认数位错开，甲乙保持各自标签', () => {
        const spec = ARITHMETIC_FIGURE_FIXTURES[1].spec;
        expect(parseFigureSpec(raw(spec))).toMatchObject({ partialProducts: [{ shift: 0 }, { shift: 1 }] });
        const document = new DOMParser().parseFromString(renderFigureSpec(raw(spec))!, 'image/svg+xml');
        const rows = Array.from(document.querySelectorAll('text[data-arithmetic-row="partial"]'));
        expect(rows.map((element) => element.textContent)).toEqual(['□□□', '□□']);
        const positions = rows.map((element) => element.getAttribute('x')!.split(/\s+/).map(Number));
        const step = positions[0][1] - positions[0][0];
        expect(positions[0].at(-1)! - positions[1].at(-1)!).toBe(step);
        const labels = Array.from(document.querySelectorAll('text')).filter((element) => ['甲', '乙'].includes(element.textContent ?? ''));
        expect(labels.map((element) => element.textContent)).toEqual(['甲', '乙']);
        expect(labels.map((element) => element.getAttribute('y'))).toEqual(rows.map((element) => element.getAttribute('y')));
    });

    it('部分积只有一行时仍尊重显式十位，不按行数重排', () => {
        const spec = { ...multiplication, top: '□□', partialProducts: [{ value: '□□', label: '乙', shift: 1 }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ partialProducts: [{ value: '□□', label: '乙', shift: 1 }] });
    });

    it.each([
        { partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 0 }], name: '重复数位' },
        { partialProducts: [{ value: '170', shift: 2 }], name: '超出乘数位数' },
        { partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 1 }, { value: '1' }], name: '默认位移超出位数' },
    ])('$name 时不返回貌似有效的竖式，保留旧图或无图回退', ({ partialProducts }) => {
        const spec = raw({ ...multiplication, partialProducts });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>保留原配图</text></svg>';
        expect(parseFigure('true', legacy, spec)).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('未知乘数不猜测位数或数字，但仍拒绝重复声明同一数位', () => {
        const spec = { ...multiplication, bottom: 'n', partialProducts: [{ value: 'a', shift: 0 }, { value: 'b', shift: 2 }] };
        expect(parseFigureSpec(raw(spec))).toMatchObject({ bottom: 'n', partialProducts: spec.partialProducts });
        expect(parseFigureSpec(raw({ ...spec, partialProducts: [{ value: 'a', shift: 0 }, { value: 'b', shift: 0 }] }))).toBeNull();
    });

    it('任一子图数位错误时整组回退，不能漏掉有问题的选项', () => {
        const spec = raw({ type: 'figure_group', figures: [
            { label: 'A', figure: multiplication },
            { label: 'B', figure: { ...multiplication, partialProducts: [{ value: '1', shift: 8 }] } },
        ] });
        expect(renderFigureSpecDetailed(spec)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation', type: 'figure_group' } });
        expect(parseFigure('true', null, spec)).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('图组保留子图作答空格，不因嵌套重新计算答案', () => {
        const spec = raw({ type: 'figure_group', figures: ARITHMETIC_FIGURE_FIXTURES.slice(0, 2).map(({ spec }, index) => ({ label: 'AB'[index], figure: spec })) });
        const svg = renderFigureSpec(spec);
        expect(svg).not.toBeNull();
        expect(svg).toContain('>1□0</text>');
        expect(svg).not.toContain('>850</text>');
        expect(svg).not.toContain('>170</text>');
    });

    it.each([
        { operation: '×', expected: '850' }, { operation: '+', expected: '59' }, { operation: '-', expected: '9' },
    ])('保留 %s 已有纯整数结果的精确复算，不把空格保护扩大成禁用数值校验', ({ operation, expected }) => {
        expect(parseFigureSpec(raw({ ...multiplication, operation, partialProducts: [], result: '999' }))).toMatchObject({ result: expected });
    });

    it('大整数继续精确复算，不丢失超过安全整数范围的数字', () => {
        expect(parseFigureSpec(raw({ ...multiplication, top: '99999999999999999', bottom: '9', partialProducts: [], result: '1' })))
            .toMatchObject({ result: '899999999999999991' });
    });

    it('除法使用独立长除法布局，精确保留商、余数和逐步减数的数位', () => {
        const division = {
            type: 'vertical_arithmetic', operation: '÷', top: '847', bottom: '7',
            divisionSteps: [
                { value: '8', subtract: '7', shift: 2 }, { value: '14', subtract: '14', shift: 1 }, { value: '7', subtract: '7', shift: 0 },
            ], result: '999', remainder: '8',
        };
        const parsed = parseFigureSpec(raw(division));
        expect(parsed).toMatchObject({
            operation: '÷', result: '121', remainder: '0',
            divisionSteps: [
                { value: '8', subtract: '7', shift: 2 }, { value: '14', subtract: '14', shift: 1 }, { value: '7', subtract: '7', shift: 0 },
            ],
        });
        const svg = renderFigureSpec(raw(division));
        expect(svg).not.toBeNull();
        expect(svg).toContain('>121</text>');
        expect(svg).toContain('>847</text>');
        expect(svg).toContain('>7</text>');
        expect(svg).toContain('>余数 0</text>');
        expect(svg).toContain('data-arithmetic-row="division-divisor"');
        expect(svg).toContain('data-arithmetic-row="division-value"');
        expect(svg).toContain('data-arithmetic-row="division-subtract"');
        expect(svg).toContain('<path');
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const quotient = document.querySelector('[data-arithmetic-row="division-quotient"]')!;
        const dividend = document.querySelector('[data-arithmetic-row="division-dividend"]')!;
        const divisor = document.querySelector('[data-arithmetic-row="division-divisor"]')!;
        expect(Number(quotient.getAttribute('y'))).toBeLessThan(Number(dividend.getAttribute('y')));
        expect(Number(divisor.getAttribute('x'))).toBeLessThan(Number(dividend.getAttribute('x')!.split(/\s+/u).at(0)));
    });

    it('除法除数为零、逐步减数没有位移或非除法带余数时整图回退', () => {
        expect(parseFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '84', bottom: '0', partialProducts: [], result: '0', remainder: '0',
        }))).toBeNull();
        expect(parseFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '-84', bottom: '4', partialProducts: [], result: '-21', remainder: '0',
        }))).toBeNull();
        expect(parseFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '84', bottom: '-4', partialProducts: [], result: '-21', remainder: '0',
        }))).toBeNull();
        expect(parseFigureSpec(raw({
            type: 'vertical_arithmetic', operation: '÷', top: '84', bottom: '4', divisionSteps: [{ value: '8', subtract: '8', shift: 1 }], result: '21',
        }))).toBeNull();
        expect(parseFigureSpec(raw({ ...multiplication, remainder: '0' }))).toBeNull();
    });

    it('统一提示词要求保留空格，并明确每行乘法位移不能重复', () => {
        expect(FIGURE_SPEC_RULES).toContain('不得把作答空格替换为计算结果');
        expect(FIGURE_SPEC_RULES).toContain('不同部分积不能重复使用同一 shift');
        expect(FIGURE_SPEC_RULES).toContain('除法中 top 是被除数、bottom 是除数、result 是商、remainder 是余数');
        expect(FIGURE_SPEC_RULES).toContain('小数乘法按末位数字对齐');
        expect(FIGURE_SPEC_RULES).toContain('小数点和正负号不计入乘数的数字位数');
    });
});

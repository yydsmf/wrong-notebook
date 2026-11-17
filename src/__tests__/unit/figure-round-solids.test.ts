import { describe, expect, it } from 'vitest';
import { ROUND_SOLID_FIXTURES } from '@/__tests__/fixtures/figure-round-solid-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';
import { projectRoundSolid } from '@/lib/figure-round-solids';

const raw = (spec: unknown) => JSON.stringify(spec);
const cylinder = ROUND_SOLID_FIXTURES[0].spec;
const cone = ROUND_SOLID_FIXTURES[4].spec;

describe('圆柱和圆锥结构化模板', () => {
    it.each(ROUND_SOLID_FIXTURES)('$id 可由公开入口解析并绘制，保留全部标注', ({ spec }) => {
        expect(parseFigureSpecDetailed(raw(spec))).toMatchObject({ spec, diagnostic: { ok: true } });
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        for (const label of [spec.radiusLabel, spec.diameterLabel, spec.heightLabel, spec.slantLabel, spec.title]) {
            if (label) expect(document.documentElement.textContent).toContain(label);
        }
    });

    it.each(ROUND_SOLID_FIXTURES)('$id 等比放大不改变投影、标签与尺寸线', ({ spec }) => {
        expect(renderFigureSpec(raw({ ...spec, radius: spec.radius * 2, height: spec.height * 2 }))).toBe(renderFigureSpec(raw(spec)));
    });

    it.each([
        { ...cylinder, radiusLabel: '半径3cm', diameterLabel: '直径5cm' },
        { ...cylinder, radiusLabel: 'radius 3 cm', diameterLabel: 'diameter 5 cm' },
        { ...cylinder, radiusLabel: '?', diameterLabel: '0cm' },
        { ...cylinder, heightLabel: 'height -1 cm' },
        { ...cone, slantLabel: '母线6cm' },
        { ...cone, radiusLabel: '?', diameterLabel: '6cm', slantLabel: '6cm' },
        { ...cone, radiusLabel: '半径1/0cm' },
        { ...cone, slantLabel: 'slant height 6cm' },
        { ...cone, radiusLabel: '直径3cm' },
        { ...cone, heightLabel: '母线4cm' },
        { ...cone, slantLabel: '高5cm' },
        { ...cone, diameterLabel: 'radius 6cm' },
    ])('明确长度冲突或角色错配时整图回退：%j', (spec) => {
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each([
        { ...cone, radiusLabel: '0.03m', heightLabel: '40mm', slantLabel: '0.5dm' },
        { ...cone, radiusLabel: '1 1/2cm', heightLabel: '2cm', slantLabel: '2.5cm' },
        { ...cone, radiusLabel: '1又1/2cm', heightLabel: '20mm', slantLabel: '25mm' },
        { ...cone, radiusLabel: undefined, diameterLabel: '3cm', heightLabel: '20mm', slantLabel: '25mm' },
        { ...cone, radiusLabel: 'r=3', heightLabel: 'h=4', slantLabel: 'l=5' },
        { ...cone, radiusLabel: '?cm', heightLabel: '□cm', slantLabel: 'x+1cm' },
        { ...cone, radiusLabel: '3cm', heightLabel: '4', slantLabel: '6cm' },
    ])('保留单位、分数、未知量及独立单位类别：%j', (spec) => {
        expect(parseFigureSpecDetailed(raw(spec)).diagnostic.ok).toBe(true);
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });

    it.each([
        { ...cylinder, radius: 0 }, { ...cone, height: -1 }, { ...cone, radius: 101 },
        { ...cylinder, slantLabel: '5cm' }, { ...cone, shape: 'frustum' },
    ])('不支持或非法结构不强行套模板：%j', (spec) => {
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'schema_validation' } });
    });

    it.each(['cylinder', 'cone'] as const)('%s 极端比例或不可读标注完整回退', (shape) => {
        for (const spec of [
            { ...cylinder, shape, radius: 100, height: 0.001 },
            { ...cylinder, shape, radius: 0.001, height: 100 },
            { ...cylinder, shape, title: '1234567890'.repeat(6) },
            { ...cylinder, shape, radiusLabel: '非常长的半径标注无法在有限的尺寸线上保持可读'.repeat(1) },
        ]) expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it.each([0.4, 0.7, 1, 2, 4, 8])('圆锥高径比例 %s 的轮廓与椭圆相切，高与母线明确分开', (ratio) => {
        const spec = { type: 'round_solid' as const, shape: 'cone' as const, radius: 3, height: 3 * ratio };
        const projection = projectRoundSolid(spec)!;
        expect(projection).not.toBeNull();
        const { center, top, left, right, rx, ry } = projection;
        for (const tangent of [left, right]) {
            const dx = tangent.x - center.x;
            const dy = tangent.y - center.y;
            expect(dx ** 2 / rx ** 2 + dy ** 2 / ry ** 2).toBeCloseTo(1, 10);
            expect((top.x - tangent.x) * dx / rx ** 2 + (top.y - tangent.y) * dy / ry ** 2).toBeCloseTo(0, 10);
        }
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        const axis = document.querySelector('[data-round-solid-part="axis"] line')!;
        expect(axis.getAttribute('x1')).toBe(axis.getAttribute('x2'));
        const slant = document.querySelector('[data-round-solid-part="right-edge"] line')!;
        expect(slant.getAttribute('x1')).not.toBe(slant.getAttribute('x2'));
        expect(document.querySelector('[data-round-solid-part="base-back"] path')!.getAttribute('stroke-dasharray')).toBe('7 5');
        expect(document.querySelector('[data-round-solid-part="base-front"] path')!.hasAttribute('stroke-dasharray')).toBe(false);
    });

    it.each([4, 8])('细长圆锥比例 %s 放不下完整尺寸文字时整图回退，不改变比例', (ratio) => {
        const spec = { ...cone, radius: 3, height: 3 * ratio };
        expect(parseFigureSpecDetailed(raw(spec))).toMatchObject({ spec, diagnostic: { ok: true } });
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
    });

    it.each([
        [cylinder, '下图是一个圆锥，半径3cm，高5cm。'],
        [cone, '下图是一个圆柱，半径3cm，高4cm。'],
        [cone, '下图是一个正方体。'],
        [{ type: 'solid_geometry', shape: 'cube', width: 4, depth: 4, height: 4 }, '下图是一个圆柱。'],
        [cone, '下图是一个圆锥，底面半径4cm，高4cm。'],
        [cone, '下图是一个圆锥，底面直径8cm，高4cm。'],
        [cone, '下图是一个圆锥，高5cm。'],
        [cone, '下图是一个圆锥，母线6cm。'],
        [cone, '下图是一个圆锥，半径、高、母线分别为3、4、6厘米。'],
        [cone, 'The figure is a cone, radius 4cm.'],
        [cone, 'The figure is a cone, base diameter 8cm.'],
        [cone, 'The figure is a cone, radius, height, and slant height are 3cm, 4cm, and 6cm respectively.'],
    ])('核对明确的主图声明及尺寸：%s，%s', (spec, text) => {
        expect(renderFigureSpecDetailed(raw(spec), text as string)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each([
        '下图是一个圆锥，底面半径3cm，高4cm，母线5cm。',
        '下图是一个圆锥，半径、高、母线分别为3、4、5厘米。',
        'The figure is a cone, base radius 3cm, height 4cm, slant height 5cm.',
        'The figure is a cone, radius, height, and slant height are 3cm, 4cm, and 5cm respectively.',
        '如果下图是一个圆柱，高20cm，应怎样计算？',
        '下图是一个圆柱吗？',
        '下图是一个圆柱的展开图。',
        '下图是一个圆锥，半径3cm。另一个圆锥高8cm。',
        '下图是一个圆锥，高x+1cm。',
    ])('保留匹配声明、未知量和保守语境：%s', (text) => {
        expect(renderFigureSpec(raw(cone), text)).not.toBeNull();
    });

    it('只显示题中已知标注，不补半径、直径、母线或计算答案', () => {
        const spec = { type: 'round_solid', shape: 'cone', radius: 3, height: 4, heightLabel: '高4cm' };
        const svg = renderFigureSpec(raw(spec))!;
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(Array.from(document.querySelectorAll('text'), (element) => element.textContent)).toEqual(['高4cm']);
        expect(document.querySelector('[data-round-solid-part="diameter"]')).toBeNull();
        expect(document.querySelector('[data-round-solid-part="radius"]')).toBeNull();
    });

    it('图组逐图校验，任一子图失败不丢弃选项且沿用旧图兜底', () => {
        const good = { type: 'figure_group', figures: [{ label: '甲', figure: cylinder }, { label: '乙', figure: cone }] };
        expect(renderFigureSpec(raw(good))).not.toBeNull();
        expect(renderFigureSpecDetailed(raw({ ...good, compareSizes: true })).diagnostic.reason).toBe('semantic_validation');
        const text = '甲：下图是一个圆柱，半径3cm，高5cm。乙：下图是一个圆锥，半径4cm，高4cm。';
        expect(renderFigureSpecDetailed(raw(good), text).diagnostic.reason).toBe('semantic_validation');
        const bad = { ...good, figures: [good.figures[0], { label: '乙', figure: { ...cone, radius: 0.001 } }] };
        expect(renderFigureSpecDetailed(raw(bad))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有完整双图</text></svg>';
        expect(parseFigure('true', legacy, raw(bad))).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(bad))).toEqual({ hasFigure: true, figureSvg: null });
    });
});

import { describe, expect, it } from 'vitest';
import { SPHERE_FIXTURES } from '@/__tests__/fixtures/figure-sphere-fixtures';
import { parseFigure } from '@/lib/ai/schema';
import { parseFigureSpecDetailed, renderFigureSpec, renderFigureSpecDetailed } from '@/lib/figure-spec';

const raw = (spec: unknown) => JSON.stringify(spec);
const sphere = SPHERE_FIXTURES[2].spec;

describe('球体的结构化配图', () => {
    it.each(SPHERE_FIXTURES)('$id 经公开入口解析并保留完整标签', ({ spec }) => {
        expect(parseFigureSpecDetailed(raw(spec))).toMatchObject({ spec, diagnostic: { ok: true } });
        const svg = renderFigureSpec(raw(spec));
        expect(svg).not.toBeNull();
        const document = new DOMParser().parseFromString(svg!, 'image/svg+xml');
        expect(document.querySelector('parsererror')).toBeNull();
        for (const label of [spec.radiusLabel, spec.diameterLabel, spec.title]) {
            if (label) expect(document.documentElement.textContent).toContain(label);
        }
    });

    it.each(SPHERE_FIXTURES)('$id 单图示意半径不冒充跨图物理大小', ({ spec }) => {
        expect(renderFigureSpec(raw({ ...spec, radius: spec.radius * 2 }))).toBe(renderFigureSpec(raw(spec)));
    });

    it('球的圆形轮廓、赤道和尺寸线各自保留正确的几何关系', () => {
        const svg = renderFigureSpec(raw(sphere))!;
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const outline = document.querySelector('[data-sphere-part="outline"] circle')!;
        const radius = Number(outline.getAttribute('r'));
        const center = { x: Number(outline.getAttribute('cx')), y: Number(outline.getAttribute('cy')) };
        for (const [name, multiple] of [['radius', 1], ['diameter', 2]] as const) {
            const dimension = document.querySelector(`[data-sphere-part="${name}"] line`)!;
            expect(Number(dimension.getAttribute('x2')) - Number(dimension.getAttribute('x1'))).toBe(radius * multiple);
            expect(Number(dimension.getAttribute('x2'))).toBe(center.x + radius);
            expect(dimension.getAttribute('y1')).toBe(dimension.getAttribute('y2'));
            const label = Array.from(document.querySelectorAll('text')).find((text) => text.textContent === sphere[`${name}Label`])!;
            expect(label.getAttribute('data-from-x')).toBe(dimension.getAttribute('x1'));
            expect(label.getAttribute('data-to-x')).toBe(dimension.getAttribute('x2'));
        }
        expect(document.querySelector('[data-sphere-part="equator-front"] path')!.hasAttribute('stroke-dasharray')).toBe(false);
        expect(document.querySelector('[data-sphere-part="equator-back"] path')!.getAttribute('stroke-dasharray')).toBe('7 5');
    });

    it.each([
        { ...sphere, radiusLabel: '3cm', diameterLabel: '5cm' },
        { ...sphere, radiusLabel: '1/2m', diameterLabel: '90厘米' },
        { ...sphere, radiusLabel: '0cm' },
        { ...sphere, diameterLabel: 'd=-1cm' },
        { ...sphere, radiusLabel: 'radius 1/0cm' },
        { ...sphere, radiusLabel: '直径3cm' },
        { ...sphere, diameterLabel: '半径6cm' },
        { ...sphere, radiusLabel: 'h=3cm' },
    ])('明确数值或角色冲突时完整回退：%j', (spec) => {
        expect(renderFigureSpecDetailed(raw(spec))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each([
        ['半径1 1/2cm', '直径30mm'],
        ['radius 3cm', 'diameter 6cm'],
        ['r=□cm', 'd=?cm'],
        ['3', '6cm'],
    ])('保留分数、未知量与各自的单位类别：%s、%s', (radiusLabel, diameterLabel) => {
        const spec = { ...sphere, radiusLabel, diameterLabel };
        expect(parseFigureSpecDetailed(raw(spec))).toMatchObject({ spec, diagnostic: { ok: true } });
        expect(renderFigureSpec(raw(spec))).not.toBeNull();
    });

    it.each([0, -1, 101])('非法示意半径 %s 不强行修成有效图', (radius) => {
        expect(renderFigureSpecDetailed(raw({ ...sphere, radius })).diagnostic.reason).toBe('schema_validation');
    });

    it.each([
        '下图是一个球体，半径4cm。',
        '下图是一个球，直径8cm。',
        '下图是一个圆柱。',
        'The figure is a sphere, radius 4cm.',
        'The figure is a sphere, radius and diameter are 4cm and 8cm respectively.',
    ])('明确球体主图与尺寸冲突时回退：%s', (question) => {
        expect(renderFigureSpecDetailed(raw(sphere), question)).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });

    it.each([
        '下图是一个球体，半径3cm，直径6cm。',
        '下图是一个球，半径和直径分别为3和6厘米。',
        'The figure is a sphere, radius and diameter are 3cm and 6cm respectively.',
        '如果下图是一个球，半径4cm，会怎样？',
        '下图是一个球吗？',
        '下图是一个球体的截面。',
        '下图是一个球，半径3cm。另一个球的半径4cm。',
        '下图是一个球体，半径x+1cm。',
    ])('匹配声明及保守语境保持原内容：%s', (question) => {
        expect(renderFigureSpec(raw(sphere), question)).not.toBeNull();
    });

    it('没有标签时只绘图，不从示意半径生成答案', () => {
        const svg = renderFigureSpec(raw({ type: 'sphere_geometry', radius: 3 }))!;
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(document.querySelectorAll('text')).toHaveLength(0);
        expect(document.querySelector('[data-sphere-part="radius"]')).toBeNull();
        expect(document.querySelector('[data-sphere-part="diameter"]')).toBeNull();
    });

    it('题干中的球不能由圆柱或长方体模板冒充', () => {
        const question = '下图是一个球体。';
        for (const spec of [
            { type: 'round_solid', shape: 'cylinder', radius: 3, height: 5 },
            { type: 'solid_geometry', shape: 'cube', width: 4, depth: 4, height: 4 },
        ]) expect(renderFigureSpecDetailed(raw(spec), question).diagnostic.reason).toBe('semantic_validation');
    });

    it('长标签或标题不能可靠排版时整图回退，原图和旧 SVG 仍可兜底', () => {
        const bad = { ...sphere, title: '1234567890'.repeat(6) };
        expect(renderFigureSpecDetailed(raw(bad))).toMatchObject({ svg: null, diagnostic: { reason: 'renderer_unavailable' } });
        const legacy = '<svg xmlns="http://www.w3.org/2000/svg"><text>原有完整球体图</text></svg>';
        expect(parseFigure('true', legacy, raw(bad))).toEqual({ hasFigure: true, figureSvg: legacy });
        expect(parseFigure('true', null, raw(bad))).toEqual({ hasFigure: true, figureSvg: null });
    });

    it('球体图组不比较画布适配后的实际大小，任一失败完整回退', () => {
        const group = { type: 'figure_group', figures: [{ label: '甲', figure: sphere }, { label: '乙', figure: { ...sphere, radiusLabel: '4cm', diameterLabel: '8cm' } }] };
        expect(renderFigureSpec(raw(group))).not.toBeNull();
        expect(renderFigureSpecDetailed(raw({ ...group, compareSizes: true })).diagnostic.reason).toBe('semantic_validation');
        expect(renderFigureSpecDetailed(raw(group), '甲：下图是一个球体，半径3cm。乙：下图是一个球体，半径5cm。').diagnostic.reason).toBe('semantic_validation');
        const bad = { ...group, figures: [group.figures[0], { label: '乙', figure: { ...sphere, radiusLabel: '4cm', diameterLabel: '7cm' } }] };
        expect(renderFigureSpecDetailed(raw(bad))).toMatchObject({ svg: null, diagnostic: { reason: 'semantic_validation' } });
    });
});

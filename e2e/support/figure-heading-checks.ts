/** 分别核对标题和内层图形的实际字形，避免混用两个 SVG 坐标系。 */
export async function inspectFigureHeadings(markup: string) {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
    host.append(svg);
    document.body.append(host);
    try {
        await document.fonts.ready;
        const issues: string[] = [];
        const within = (inner: DOMRect, outer: DOMRect) => inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5
            && inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;
        const headings = Array.from(svg.querySelectorAll<SVGTextElement>('text[data-figure-title="true"]'));
        const bodies = headings.map((heading) => {
            const owner = heading.ownerSVGElement!;
            const body = owner.querySelector<SVGSVGElement>('g[data-figure-body="true"] > svg')!;
            if (!body) throw new Error('标题没有对应的内层图形');
            if (!within(body.getBoundingClientRect(), owner.getBoundingClientRect())) issues.push('内层图形越出标题画布');
            if (heading.getBoundingClientRect().bottom + 8 > body.getBoundingClientRect().top) issues.push('标题与图形间距不足');
            const lines = Array.from(heading.querySelectorAll('tspan'));
            lines.forEach((line, index) => {
                if (index > 0 && line.getBBox().y < lines[index - 1].getBBox().y + lines[index - 1].getBBox().height + 0.5) issues.push('标题行间距不足');
            });
            const bounds = body.viewBox.baseVal;
            if (Math.abs(body.width.baseVal.value / bounds.width - body.height.baseVal.value / bounds.height) > 0.000001) issues.push('内层图形横纵比例不一致');
            for (const shape of body.querySelectorAll<SVGGraphicsElement>('line, path, circle, polygon, polyline')) {
                const box = shape.getBBox();
                const padding = Number(shape.getAttribute('stroke-width') ?? 0) / 2;
                if (box.x - padding < bounds.x - 0.5 || box.y - padding < bounds.y - 0.5
                    || box.x + box.width + padding > bounds.x + bounds.width + 0.5
                    || box.y + box.height + padding > bounds.y + bounds.height + 0.5) issues.push('内层图形或描边被裁切');
            }
            return {
                title: heading.textContent,
                lines: lines.map((line) => line.textContent ?? ''),
                titleSize: Number(heading.getAttribute('font-size')),
                markup: new XMLSerializer().serializeToString(body),
                scale: Math.hypot(body.getScreenCTM()!.a, body.getScreenCTM()!.b),
            };
        });
        for (const text of svg.querySelectorAll<SVGTextElement>('text')) {
            if (!within(text.getBoundingClientRect(), text.ownerSVGElement!.getBoundingClientRect())) issues.push(`文字越出所属画布：${text.textContent}`);
        }
        return { issues, bodies };
    } finally { host.remove(); }
}

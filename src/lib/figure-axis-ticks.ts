export interface FigureAxisTick {
    value: number;
    label: string;
}

function decimalParts(value: number): { units: bigint; places: number } {
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const places = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
    const units = BigInt(mantissa.replace('.', ''));
    return places >= 0
        ? { units, places }
        : { units: units * BigInt(10) ** BigInt(-places), places: 0 };
}

function decimalLabel(units: bigint, places: number): string {
    const negative = units < BigInt(0);
    const digits = (negative ? -units : units).toString().padStart(places + 1, '0');
    const whole = places ? digits.slice(0, -places) : digits;
    const fraction = places ? digits.slice(-places).replace(/0+$/, '') : '';
    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** 按 JSON 数值的十进制表示生成刻度，不因浮点除法漏端点或四舍五入改写数值。 */
export function createFigureAxisTicks(min: number, max: number, step: number): FigureAxisTick[] | null {
    if (![min, max, step, max - min].every(Number.isFinite) || max <= min || step <= 0) return null;
    const parts = [min, max, step].map(decimalParts);
    const places = Math.max(...parts.map((part) => part.places));
    const [start, end, interval] = parts.map((part) => part.units * BigInt(10) ** BigInt(places - part.places));
    const count = (end - start) / interval + BigInt(1);
    if (count > BigInt(25)) return null;

    const ticks: FigureAxisTick[] = [];
    for (let index = 0; index < Number(count); index += 1) {
        const label = decimalLabel(start + BigInt(index) * interval, places);
        const value = Number(label);
        const previous = ticks.at(-1);
        // 数字坐标已无法区分相邻刻度时，不画多个位置相同而数值不同的标签。
        if (!Number.isFinite(value) || value < min || value > max || (previous && value <= previous.value)) return null;
        ticks.push({ value, label });
    }
    return ticks;
}

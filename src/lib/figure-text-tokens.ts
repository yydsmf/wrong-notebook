const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const chineseUnit = String.raw`(?:(?:平方|立方)?(?:千米|分米|厘米|毫米|微米|米)|公顷|千克|毫克|克|吨|毫升|升|小时|分钟|摄氏度|秒|元|角|分|度)`;
const unit = String.raw`(?:${chineseUnit}|mm|cm|dm|km|m|mg|kg|g|t|mL|ml|L|l|min|h|s|Hz|N|Pa|J|W|°C|℃|℉|°|%|‰)(?:[²³23]|\^[23])?`;
const unitExpression = String.raw`${unit}(?:\s*[\/·]\s*${unit})?`;
const unitPattern = new RegExp(`^(?:${unitExpression})[,.]*$`, 'u');
const delimitedMath = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:\\.|[^$\\\n])+?\$/g;
const mathRun = new RegExp(String.raw`[\p{Script=Latin}\p{Script=Greek}\p{N}\p{M}\u2070-\u209f\u2100-\u214f\u{1d400}-\u{1d7ff}+\-−±×÷*=<>≤≥≠≈.,:∶\/⁄%‰°′″^()[\]{}√∛∜⋅·\\]+(?:\s*${chineseUnit}(?:\s*\/\s*${chineseUnit})?)?`, 'uy');
const rawLatexCommands = new Set([
    'angle', 'binom', 'boxed', 'dfrac', 'frac', 'mathit', 'mathbf', 'mathrm', 'overline', 'overrightarrow',
    'left', 'sqrt', 'text', 'tfrac', 'triangle', 'underline', 'vec',
]);
const numberMarker = /[\p{N}\u2070-\u209f′″]/u;
const mathMarker = /[\p{Lm}+−±×÷*=<>≤≥≠≈:∶\/⁄^√∛∜⋅]/u;
const operationAtEnd = /[+\-−±×÷*=<>≤≥≠≈:∶\/⁄^√∛∜⋅·([{]$/u;
const operationAtStart = /^[+\-−±×÷*=<>≤≥≠≈:∶\/⁄^⋅·)\]}]/u;

interface TextToken {
    text: string;
    math: boolean;
    joined?: boolean;
}

function skipLatexWhitespace(value: string, offset: number): number {
    let index = offset;
    while (/\s/u.test(value[index] ?? '')) index++;
    return index;
}

function readLatexGroup(value: string, offset: number, open: string, close: string): number | null {
    if (value[offset] !== open) return null;
    let depth = 0;
    for (let index = offset; index < value.length; index++) {
        const character = value[index];
        if (character === '\\') {
            index++;
            continue;
        }
        if (character === open) depth++;
        if (character === close && --depth === 0) return index + 1;
    }
    return null;
}

function readLatexDelimiter(value: string, offset: number): number | null {
    const cursor = skipLatexWhitespace(value, offset);
    if (value[cursor] === '\\') {
        const command = /^\\[A-Za-z]+/u.exec(value.slice(cursor))?.[0];
        return command ? cursor + command.length : null;
    }
    return /[()[\]{}|<>.]/u.test(value[cursor] ?? '') ? cursor + 1 : null;
}

function readLeftRightExpression(value: string, offset: number): number | null {
    const firstDelimiterEnd = readLatexDelimiter(value, offset);
    if (firstDelimiterEnd === null) return null;
    let cursor: number = firstDelimiterEnd;
    let depth = 1;
    while (cursor < value.length) {
        if (value[cursor] === '{') {
            const groupEnd = readLatexGroup(value, cursor, '{', '}');
            if (groupEnd === null) return null;
            cursor = groupEnd;
            continue;
        }
        if (value[cursor] !== '\\') {
            cursor++;
            continue;
        }
        if (value[cursor + 1] === '\\') {
            cursor += 2;
            continue;
        }
        const command = /^\\([A-Za-z]+)/u.exec(value.slice(cursor));
        if (!command) {
            cursor++;
            continue;
        }
        const name = command[1];
        const commandEnd: number = cursor + command[0].length;
        if (name === 'left' || name === 'right') {
            const delimiterEnd = readLatexDelimiter(value, commandEnd);
            if (delimiterEnd === null) return null;
            depth += name === 'left' ? 1 : -1;
            cursor = delimiterEnd;
            if (depth === 0) return cursor;
        } else {
            cursor = commandEnd;
        }
    }
    return null;
}

function readRawLatex(value: string, offset: number): number | null {
    if (value[offset] !== '\\') return null;
    const command = /^\\([A-Za-z]+)/u.exec(value.slice(offset))?.[1];
    if (!command || !rawLatexCommands.has(command)) return null;
    let cursor = offset + command.length + 1;
    if (command === 'left') {
        return readLeftRightExpression(value, cursor);
    }
    const groupCount = ['binom', 'dfrac', 'frac', 'tfrac'].includes(command) ? 2 : 1;
    if (command === 'sqrt') {
        cursor = skipLatexWhitespace(value, cursor);
        if (value[cursor] === '[') {
            const optionalEnd = readLatexGroup(value, cursor, '[', ']');
            if (optionalEnd === null) return null;
            cursor = optionalEnd;
        }
    }
    for (let index = 0; index < groupCount; index++) {
        cursor = skipLatexWhitespace(value, cursor);
        const groupEnd = readLatexGroup(value, cursor, '{', '}');
        if (groupEnd === null) return null;
        cursor = groupEnd;
    }
    while (value[cursor] === '^' || value[cursor] === '_') {
        cursor = skipLatexWhitespace(value, cursor + 1);
        const groupEnd = value[cursor] === '{' ? readLatexGroup(value, cursor, '{', '}') : null;
        if (groupEnd !== null) cursor = groupEnd;
        else if (value[cursor]) cursor++;
        else return null;
    }
    return cursor;
}

/** 保留常见数学表达式、数值单位和完整字形；这是分行规则，不计算或改写公式。 */
export function tokenizeFigureText(value: string): string[] {
    const graphemes = Array.from(graphemeSegmenter.segment(value));
    const boundaries = new Set([...graphemes.map((entry) => entry.index), value.length]);
    const mathSegments = Array.from(value.matchAll(delimitedMath), (match) => ({ text: match[0], start: match.index! }));
    const tokens: TextToken[] = [];
    let offset = 0;
    let mathIndex = 0;
    for (let index = 0; index < graphemes.length;) {
        const grapheme = graphemes[index];
        if (grapheme.index < offset) { index++; continue; }
        const mathSegment = mathSegments[mathIndex];
        if (mathSegment?.start === offset) {
            tokens.push({ text: mathSegment.text, math: true, joined: true });
            offset += mathSegment.text.length;
            mathIndex++;
            index++;
            continue;
        }
        if (/^\s+$/u.test(grapheme.segment)) {
            let whitespace = grapheme.segment;
            while (/^\s+$/u.test(graphemes[index + 1]?.segment ?? '')) {
                index++;
                whitespace += graphemes[index].segment;
            }
            tokens.push({ text: whitespace, math: false });
            offset += whitespace.length;
            index++;
            continue;
        }
        const latexEnd = readRawLatex(value, offset);
        if (latexEnd !== null && boundaries.has(latexEnd)) {
            tokens.push({ text: value.slice(offset, latexEnd), math: true, joined: true });
            offset = latexEnd;
            index++;
            continue;
        }
        mathRun.lastIndex = offset;
        const match = mathRun.exec(value);
        if (match && boundaries.has(offset + match[0].length)) {
            tokens.push({ text: match[0], math: true });
            offset += match[0].length;
        } else {
            tokens.push({ text: grapheme.segment, math: false });
            offset += grapheme.segment.length;
        }
        index++;
    }

    const expressions: TextToken[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const current = { ...tokens[index] };
        while (current.math && /^\s+$/u.test(tokens[index + 1]?.text ?? '') && tokens[index + 2]?.math) {
            const next = tokens[index + 2].text;
            const coordinate = /[([{]/u.test(current.text) && /,$/u.test(current.text);
            const factor = /^[([{]/u.test(next) && (numberMarker.test(current.text) || /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(current.text));
            if (!operationAtEnd.test(current.text) && !operationAtStart.test(next) && !coordinate && !factor
                && !(numberMarker.test(current.text) && unitPattern.test(next))) break;
            current.text += tokens[index + 1].text + next;
            current.joined = true;
            index += 2;
        }
        expressions.push(current);
    }

    const result: string[] = [];
    for (let index = 0; index < expressions.length; index++) {
        const current = expressions[index];
        // 带分数的空格不是两个独立数；先合并分子与分母，再把前面的整数合回来。
        if (current.math && /^\d+$/u.test(current.text) && /^\s+$/u.test(expressions[index + 1]?.text ?? '')
            && expressions[index + 2]?.math && /^\d+\s*[\/⁄]\s*\d/u.test(expressions[index + 2].text)) {
            result.push(current.text + expressions[index + 1].text + expressions[index + 2].text);
            index += 2;
        } else if (current.joined || (current.math && (numberMarker.test(current.text) || mathMarker.test(current.text)
            || /^[\p{Script=Latin}\p{Script=Greek}][-][\p{Script=Latin}\p{Script=Greek}]$/u.test(current.text)))) {
            result.push(current.text);
        } else {
            result.push(...Array.from(graphemeSegmenter.segment(current.text), (entry) => entry.segment));
        }
    }
    return result;
}

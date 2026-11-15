/**
 * 规范化多小题答案的可读性。
 *
 * 模型偶尔会把带题号的答案粘在一起，例如
 * "39.moved40.have"。只有在题干本身确认存在多个编号小题，且答案中
 * 出现了至少两个对应题号时才补充空格，避免误伤小数、公式和普通文本。
 */

const SUBQUESTION_LABEL = /(?<![\p{L}\p{N}])(?:[（(]\s*(\d{1,3})\s*[）)]|(\d{1,3})\s*[.．、:：)])(?!\d)/gu;
const ANSWER_LABEL = /(?:[（(]\s*(\d{1,3})\s*[）)]|(?<![\d.])(\d{1,3})\s*[.．、:：)])(?!\d)/gu;

function collectQuestionLabels(questionText: string): Set<string> {
    const labels = new Set<string>();
    for (const match of questionText.matchAll(SUBQUESTION_LABEL)) {
        const label = match[1] ?? match[2];
        if (label) labels.add(label);
    }
    return labels;
}

/**
 * 在明确的多小题答案编号之间补充空格。
 * 已经有分号、中文分号或换行时保持原排版，不重复添加。
 */
export function normalizeAnswerText(answerText: string, questionText?: string | null): string {
    if (!answerText.trim() || !questionText?.trim()) return answerText;

    const questionLabels = collectQuestionLabels(questionText);
    if (questionLabels.size < 2) return answerText;

    const matches = [...answerText.matchAll(ANSWER_LABEL)]
        .map((match) => ({
            index: match.index ?? 0,
            label: match[1] ?? match[2],
        }))
        .filter((match) => match.label && questionLabels.has(match.label));
    if (matches.length < 2) return answerText;

    let normalized = answerText;
    for (const match of matches.slice(1).reverse()) {
        const boundary = normalized.slice(0, match.index);
        if (/[\s;；,，、]\s*$/.test(boundary)) continue;

        // 保留题号前原有空格，把空格放在上一小题答案末尾。
        const whitespaceStart = boundary.search(/[ \t]+$/);
        const insertAt = whitespaceStart >= 0 ? whitespaceStart : match.index;
        normalized = `${normalized.slice(0, insertAt)} ${normalized.slice(insertAt)}`;
    }
    return normalized;
}

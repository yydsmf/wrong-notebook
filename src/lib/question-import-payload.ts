import type { ParsedQuestion } from '@/lib/ai/types';

/** 自动导入、人工校对和后台重试共用原有保存接口的数据格式。 */
export function buildQuestionImportPayload(parsed: ParsedQuestion & { importTaskId?: string }, options: {
    subjectId?: string | null; imageUrl?: string | null; imageUrls?: string[]; paperLevel?: string | null;
}) {
    return {
        questionText: parsed.questionText,
        answerText: parsed.answerText,
        analysis: parsed.analysis,
        wrongAnswerText: parsed.wrongAnswerText || null,
        mistakeAnalysis: parsed.mistakeAnalysis || null,
        mistakeStatus: parsed.mistakeStatus || 'unknown',
        knowledgePoints: parsed.knowledgePoints || [],
        difficultyStars: parsed.difficultyStars ?? null,
        recognizedGradeSemester: parsed.gradeSemester ?? null,
        hasFigure: parsed.hasFigure ?? false,
        figureDescription: parsed.figureDescription ?? null,
        subjectId: options.subjectId || undefined,
        subjectName: options.subjectId ? undefined : parsed.subject,
        ...(options.imageUrls && options.imageUrls.length > 1
            ? { originalImageUrls: options.imageUrls }
            : { originalImageUrl: options.imageUrls?.[0] || options.imageUrl || '' }),
        paperLevel: options.paperLevel || undefined,
        ...(parsed.importTaskId ? { importTaskId: parsed.importTaskId } : {}),
    };
}

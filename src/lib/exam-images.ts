import { parseImageFragments, serializeImageFragments } from "@/lib/image-fragments";

/** 来源题图片只有在试卷题目逐字未改写时才能用于展示。 */
export function getExactSourceImageFragments(
    questionText: string | null | undefined,
    sourceQuestionText: string | null | undefined,
    sourceImageFragments: string | null | undefined,
): string | null {
    if (!questionText || !sourceQuestionText || questionText !== sourceQuestionText) return null;
    const fragments = parseImageFragments(sourceImageFragments);
    return fragments.length > 0 ? serializeImageFragments(fragments) : null;
}

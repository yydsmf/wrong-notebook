import type { AIService, ParsedQuestion } from './types';
import { getOriginalImages } from '@/lib/original-images';
import { parseImageInput, questionImagesSchema } from './image-input';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai:similar-question-figure');

function questionNeedsReferenceFigure(questionText: string): boolean {
    return /竖式|如图|见图|图中|上图|下图|图示|统计图|数轴|电路图|示意图|(?:figure|diagram|chart|graph)\b|as shown\b/i.test(questionText);
}

interface SourceQuestionImages {
    hasFigure?: boolean | null;
    figureDescription?: string | null;
    figureSvg?: string | null;
    originalImageUrl?: string | null;
    originalImageUrls?: string | null;
}

/** 先生成新题，再用原题图片作结构参考，按新题题干单独生成 SVG。 */
export async function generateSimilarQuestionWithSourceFigure(
    ai: Pick<AIService, 'generateSimilarQuestion' | 'generateFigureSvg'>,
    input: Parameters<AIService['generateSimilarQuestion']>,
    source: SourceQuestionImages,
): Promise<ParsedQuestion> {
    const generated = await ai.generateSimilarQuestion(...input);
    const sourceHasFigure = Boolean(
        source.hasFigure
        || source.figureDescription
        || source.figureSvg
        || questionNeedsReferenceFigure(input[0]),
    );
    if (!sourceHasFigure || !generated.questionText.trim()) return generated;

    const originalImages = getOriginalImages(source).filter((image) => /^data:image\/[\w.+-]+;base64,/i.test(image));
    const validImages = questionImagesSchema.safeParse(originalImages);
    if (!validImages.success) {
        logger.warn({ imageCount: originalImages.length }, 'Skipping automatic figure generation because source images exceed limits');
        return generated;
    }

    if (validImages.data.length === 0) return generated;

    try {
        const [firstImage, ...additionalImages] = validImages.data.map((image) => parseImageInput(image));
        const figure = await ai.generateFigureSvg(
            firstImage.base64,
            firstImage.mimeType,
            generated.questionText,
            additionalImages,
        );
        if (figure.figureSvg) return { ...generated, figureSvg: figure.figureSvg };
        logger.warn({ hasFigure: figure.hasFigure }, 'Automatic figure generation returned no SVG');
    } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Automatic figure generation failed; keeping the generated question');
    }

    return generated;
}

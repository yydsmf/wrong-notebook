export type ReanswerRequestBody = {
    questionText: string;
    language: 'zh' | 'en';
    subject: string;
    imageBase64?: string;
    images?: string[];
    gradeSemester?: string;
    subjectId?: string;  // 所在错题本，用于限定候选知识点
};

export function buildReanswerRequestBody({
    questionText,
    language,
    subject,
    imagePreview,
    imagePreviews,
    gradeSemester,
    subjectId,
}: {
    questionText: string;
    language: 'zh' | 'en';
    subject: string;
    imagePreview?: string | null;
    imagePreviews?: string[];
    gradeSemester?: string;
    subjectId?: string | null;
}): ReanswerRequestBody {
    const requestBody: ReanswerRequestBody = {
        questionText,
        language,
        subject,
    };

    const firstImage = imagePreviews?.[0] || imagePreview;
    if (imagePreviews && imagePreviews.length > 1) {
        requestBody.images = imagePreviews;
    } else if (firstImage) {
        requestBody.imageBase64 = firstImage;
    }

    if (gradeSemester) {
        requestBody.gradeSemester = gradeSemester;
    }

    if (subjectId) {
        requestBody.subjectId = subjectId;
    }

    return requestBody;
}

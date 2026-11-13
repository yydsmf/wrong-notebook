import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { StudentAnswerWorkspace } from "@/components/student-answer-workspace";
import type { StudentAnswerQuestion } from "@/types/api";

describe("学生答题题目配图", () => {
    it("不把上传的整张原图作为配图回退显示", () => {
        const question = {
            id: "question-1",
            questionText: "计算 1 + 1",
            originalImageUrl: "data:image/jpeg;base64,full-original-image",
            questionImageUrl: "data:image/jpeg;base64,legacy-original-image",
        } as unknown as StudentAnswerQuestion;

        const html = renderToStaticMarkup(
            <LanguageProvider>
                <StudentAnswerWorkspace kind="review" questions={[question]} />
            </LanguageProvider>,
        );

        expect(html).not.toContain("full-original-image");
        expect(html).not.toContain("legacy-original-image");
        expect(html).not.toContain("<img");
    });
});

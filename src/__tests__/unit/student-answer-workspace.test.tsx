import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { StudentAnswerWorkspace } from "@/components/student-answer-workspace";
import type { StudentAnswerQuestion, StudentSubmission } from "@/types/api";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: { get: mocks.get } }));

const answer = {
    id: "answer-1",
    errorItemId: "question-1",
    examQuestionId: null,
    questionText: "计算 1 + 1",
    answerText: "$\\frac{1}{2}$",
    analysis: "所以结果是 $$x=\\frac{1}{2}$$。",
    userAnswer: "0",
    userAnswerImageUrl: null,
    status: "graded" as const,
    isCorrect: false,
    reason: null,
    mistakeAnalysis: null,
};

const submission: StudentSubmission = {
    id: "submission-1",
    kind: "review",
    examPaperId: null,
    status: "completed",
    totalCount: 1,
    gradedCount: 1,
    correctCount: 0,
    createdAt: "2026-11-15T00:00:00Z",
    completedAt: "2026-11-15T00:01:00Z",
    answers: [answer],
};

function expectRenderedReferenceMath() {
    const ownAnswer = Array.from(host.querySelectorAll("p"))
        .find((element) => element.textContent === "我的答案")?.parentElement;
    expect(ownAnswer).toBeDefined();
    expect(ownAnswer?.textContent).toBe("我的答案0");
    expect(host.textContent).toContain("参考答案");
    expect(host.textContent).toContain("解题说明");
    expect(host.textContent).toContain("所以结果是");
    expect(host.querySelectorAll(".markdown-content .katex .katex-html .mfrac")).toHaveLength(2);

    const visibleMathText = Array.from(host.querySelectorAll(".katex-html"), (node) => node.textContent).join("");
    expect(visibleMathText).not.toContain("\\frac");
    expect(visibleMathText).not.toContain("$$");
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
    vi.resetAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.get.mockResolvedValue(submission);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

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

describe("学生答题结果格式", () => {
    it.each(["review", "exam"] as const)("%s 当前答题结果保留学生答案并渲染参考答案公式", async (kind) => {
        const isExam = kind === "exam";
        mocks.get.mockResolvedValue({
            ...submission, kind, examPaperId: isExam ? "paper-1" : null,
            answers: [{ ...answer, errorItemId: isExam ? null : "question-1", examQuestionId: isExam ? "question-1" : null }],
        });
        const question: StudentAnswerQuestion = { id: "question-1", questionText: "计算 1 + 1" };

        await act(async () => root.render(
            <LanguageProvider>
                <StudentAnswerWorkspace kind={kind} questions={[question]} examPaperId={isExam ? "paper-1" : undefined} />
            </LanguageProvider>,
        ));

        expectRenderedReferenceMath();
    });

    it.each(["review", "exam"] as const)("%s 历史提交保留学生答案并渲染参考答案公式", async (kind) => {
        await act(async () => root.render(
            <LanguageProvider>
                <StudentAnswerWorkspace kind={kind} questions={[]} examPaperId={kind === "exam" ? "paper-1" : undefined} />
            </LanguageProvider>,
        ));

        expectRenderedReferenceMath();
    });

    it.each([false, true])("手写答案图片在当前题目或历史提交中可见（历史：%s）", async (history) => {
        const imageUrl = "data:image/png;base64,YQ==";
        mocks.get.mockResolvedValue({ ...submission, answers: [{ ...answer, userAnswer: null, userAnswerImageUrl: imageUrl }] });
        await act(async () => root.render(
            <LanguageProvider>
                <StudentAnswerWorkspace kind="review" questions={history ? [] : [{ id: "question-1", questionText: answer.questionText }]} />
            </LanguageProvider>,
        ));
        const ownAnswer = Array.from(host.querySelectorAll("p"))
            .find((element) => element.textContent === "我的答案")?.parentElement;
        const image = ownAnswer?.querySelector("img");
        expect(image?.getAttribute("src")).toBe(imageUrl);
        expect(image?.getAttribute("alt")).toBe("手写答案图片");
        expect(ownAnswer?.textContent).not.toContain("未记录答案");
    });
});

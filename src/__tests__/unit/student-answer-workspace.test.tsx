import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { StudentAnswerWorkspace } from "@/components/student-answer-workspace";
import type { StudentAnswerQuestion, StudentSubmission } from "@/types/api";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: { get: mocks.get, post: mocks.post } }));
vi.mock("@/lib/frontend-logger", () => ({ frontendLogger: { error: vi.fn() } }));

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

const question: StudentAnswerQuestion = { id: "question-1", questionText: answer.questionText };

async function renderWorkspace(kind: "review" | "exam" = "review", questions = [question], initialSubmission: StudentSubmission | null = null) {
    await act(async () => root.render(
        <LanguageProvider>
            <StudentAnswerWorkspace
                kind={kind}
                questions={questions}
                examPaperId={kind === "exam" ? "paper-1" : undefined}
                initialSubmission={initialSubmission}
            />
        </LanguageProvider>,
    ));
}

async function submitAnswers() {
    const input = host.querySelector("textarea")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "0");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = Array.from(host.querySelectorAll("button"))
        .find((element) => element.textContent === "提交今日复习")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
}

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
    mocks.post.mockResolvedValue({ id: submission.id, status: "grading" });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
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
        await renderWorkspace(kind);
        if (kind === "review") await submitAnswers();

        expectRenderedReferenceMath();
    });

    it("试卷历史提交保留学生答案并渲染参考答案公式", async () => {
        await renderWorkspace("exam", []);

        expectRenderedReferenceMath();
    });

    it.each([false, true])("手写答案图片在当前题目或历史提交中可见（历史：%s）", async (history) => {
        const imageUrl = "data:image/png;base64,YQ==";
        mocks.get.mockResolvedValue({ ...submission, answers: [{ ...answer, userAnswer: null, userAnswerImageUrl: imageUrl }] });
        await renderWorkspace(history ? "exam" : "review", history ? [] : [question]);
        if (!history) await submitAnswers();
        const ownAnswer = Array.from(host.querySelectorAll("p"))
            .find((element) => element.textContent === "我的答案")?.parentElement;
        const image = ownAnswer?.querySelector("img");
        expect(image?.getAttribute("src")).toBe(imageUrl);
        expect(image?.getAttribute("alt")).toBe("手写答案图片");
        expect(ownAnswer?.textContent).not.toContain("未记录答案");
    });
});

describe("复习作答批次", () => {
    it("进入复习不加载上次答案、手写图片、判分或参考答案", async () => {
        mocks.get.mockResolvedValue({
            ...submission,
            answers: [{ ...answer, userAnswer: "上次作答", userAnswerImageUrl: "data:image/png;base64,YQ==", reason: "上次判分", mistakeAnalysis: "上次错因" }],
        });

        await renderWorkspace();

        expect(mocks.get).not.toHaveBeenCalled();
        expect(host.querySelector("textarea")?.value).toBe("");
        expect(host.querySelector('section[aria-live="polite"]')).toBeNull();
        expect(host.querySelector("img")).toBeNull();
        for (const text of ["我的答案", "上次作答", "上次判分", "上次错因", "参考答案", "解题说明"]) {
            expect(host.textContent).not.toContain(text);
        }
    });

    it("没有待复习题时显示最近一次复习详情", async () => {
        await renderWorkspace("review", [], submission);

        expect(mocks.get).not.toHaveBeenCalled();
        expect(host.textContent).toContain("最近一次结果");
        expectRenderedReferenceMath();
    });

    it("最近一次批改仍在进行时不把未判定答案显示为答错", async () => {
        const grading = {
            ...submission,
            status: "grading" as const,
            gradedCount: 0,
            completedAt: null,
            answers: [{ ...answer, status: "grading" as const, isCorrect: null, answerText: undefined, analysis: undefined }],
        };
        await renderWorkspace("review", [], grading);

        expect(host.textContent).toContain("AI 正在批改答案");
        expect(host.textContent).not.toContain("回答错误");
    });

    it("提交后只显示本次结果并收起答题入口，新的到期题仍可空白作答", async () => {
        await renderWorkspace();
        await submitAnswers();

        expect(mocks.post).toHaveBeenCalledWith("/api/student-submissions", {
            kind: "review", examPaperId: undefined,
            answers: [{ errorItemId: question.id, userAnswer: "0", userAnswerImageUrl: undefined }],
        });
        expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/api/student-submissions/submission-1");
        expectRenderedReferenceMath();
        expect(host.querySelector("textarea")).toBeNull();
        expect(host.textContent).not.toContain("提交今日复习");
        expect(host.textContent).not.toContain("继续复习到期题目");

        await renderWorkspace("review", [{ id: "question-2", questionText: "新的到期题" }]);

        expect(mocks.get).toHaveBeenCalledTimes(1);
        expect(host.querySelector("textarea")?.value).toBe("");
        expect(host.textContent).not.toContain("我的答案");
        expect(host.textContent).not.toContain("参考答案");

        await renderWorkspace();
        expect(host.querySelector("textarea")?.value).toBe("");
        expect(host.textContent).not.toContain("我的答案");
    });

    it("批改进度不变或查询短暂失败时仍继续轮询本次提交", async () => {
        vi.useFakeTimers();
        const grading: StudentSubmission = {
            ...submission, status: "grading", gradedCount: 0, completedAt: null,
            answers: [{ ...answer, status: "grading", isCorrect: null, answerText: undefined, analysis: undefined }],
        };
        mocks.get.mockResolvedValue(grading);
        await renderWorkspace();
        await submitAnswers();

        await act(async () => vi.advanceTimersByTimeAsync(2500));
        expect(mocks.get).toHaveBeenCalledTimes(2);
        mocks.get.mockRejectedValueOnce(new Error("临时断线"));
        await act(async () => vi.advanceTimersByTimeAsync(2500));
        expect(mocks.get).toHaveBeenCalledTimes(3);
        mocks.get.mockResolvedValue(submission);
        await act(async () => vi.advanceTimersByTimeAsync(2500));
        expect(mocks.get).toHaveBeenCalledTimes(4);
        expect(mocks.get.mock.calls.every(([url]) => url === "/api/student-submissions/submission-1")).toBe(true);
        expectRenderedReferenceMath();
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(mocks.get).toHaveBeenCalledTimes(4);
    });

    it("重试失败题只重试并刷新本次提交", async () => {
        mocks.get.mockResolvedValue({ ...submission, status: "failed" });
        await renderWorkspace();
        await submitAnswers();
        mocks.get.mockResolvedValue(submission);

        const retry = Array.from(host.querySelectorAll("button"))
            .find((element) => element.textContent === "重试未完成的批改")!;
        await act(async () => retry.click());

        expect(mocks.post).toHaveBeenLastCalledWith("/api/student-submissions/submission-1/retry", {});
        expect(mocks.get).toHaveBeenLastCalledWith("/api/student-submissions/submission-1");
        expectRenderedReferenceMath();
    });
});

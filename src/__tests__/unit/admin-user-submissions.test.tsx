import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AdminUserSubmissions } from "@/components/admin/admin-user-submissions";
import { SubmissionAnswer } from "@/components/admin/submission-answer";
import { SubmissionSummary } from "@/components/admin/submission-summary";
import type { AdminSubmissionSummary, StudentSubmissionAnswer } from "@/types/api";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: { get: mocks.get } }));
vi.mock("@/lib/frontend-logger", () => ({ frontendLogger: { error: vi.fn() } }));

const summary: AdminSubmissionSummary = {
    id: "submission-1", kind: "review", examPaperId: null, examTitle: null,
    status: "failed", totalCount: 3, gradedCount: 2, correctCount: 1,
    createdAt: "2026-11-13T01:00:00Z", completedAt: "2026-11-13T01:01:00Z",
};
const answer: StudentSubmissionAnswer = {
    id: "answer-1", errorItemId: null, examQuestionId: null,
    questionText: "第一个____，第二个____ $\\frac{1}{2}$", answerText: "保留原单位1分米",
    analysis: "参考解题说明", userAnswer: "C", userAnswerImageUrl: "data:image/png;base64,YQ==",
    imageFragments: JSON.stringify([{ id: "fragment-1", imageUrl: "data:image/png;base64,Yg==", order: 0 }]),
    status: "graded", isCorrect: false, reason: "所选选项不符合条件", mistakeAnalysis: "漏看单位",
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
    vi.resetAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.get.mockImplementation(async (url: string) => url.endsWith("/submission-1")
        ? { ...summary, answers: [answer], pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 } }
        : { submissions: [summary], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } });
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

async function render() {
    await act(async () => root.render(<LanguageProvider><AdminUserSubmissions userId="student-1" /></LanguageProvider>));
}
async function click(text: string) {
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
}

describe("管理员学生答题记录", () => {
    it("正确率只使用已批改题数，未完成题不当成错误", () => {
        const html = renderToStaticMarkup(<LanguageProvider><SubmissionSummary submission={summary} /></LanguageProvider>);
        expect(html).toContain("50%");
        expect(html).toContain("部分题目未完成批改");
        expect(html).toContain("已批改 2 / 共 3 题");
        const empty = renderToStaticMarkup(<LanguageProvider><SubmissionSummary submission={{ ...summary, correctCount: 0, gradedCount: 0 }} /></LanguageProvider>);
        expect(empty).not.toContain("NaN");
        expect(empty).not.toContain("Infinity");
    });

    it("完整呈现原题格式、题图、学生答案、手写图、参考答案与错因", () => {
        const html = renderToStaticMarkup(<LanguageProvider><SubmissionAnswer answer={answer} number={1} onViewImage={vi.fn()} /></LanguageProvider>);
        expect(html).toContain("第一个____，第二个____");
        expect(html).toContain('class="katex"');
        expect(html).toContain("data:image/png;base64,YQ==");
        expect(html).toContain("data:image/png;base64,Yg==");
        expect(html).toContain("保留原单位1分米");
        expect(html).toContain("参考解题说明");
        expect(html).toContain("漏看单位");
        expect(html).toContain("所选选项不符合条件");
    });

    it("批改中且未判定对错的题不显示为答错", () => {
        const html = renderToStaticMarkup(<LanguageProvider><SubmissionAnswer answer={{ ...answer, status: "pending", isCorrect: null, mistakeAnalysis: null }} number={1} onViewImage={vi.fn()} /></LanguageProvider>);
        expect(html).toContain("AI 正在批改");
        expect(html).not.toContain("答错");
    });

    it("从用户记录打开只读详情并可返回列表", async () => {
        await render();
        expect(mocks.get).toHaveBeenCalledWith("/api/admin/users/student-1/submissions", { params: { kind: "review", page: "1", pageSize: "10" } });
        expect(host.textContent).toContain("共 1 次提交");
        await click("查看批改");
        expect(mocks.get).toHaveBeenCalledWith("/api/admin/users/student-1/submissions/submission-1", { params: { page: "1", pageSize: "5" } });
        expect(host.textContent).toContain("漏看单位");
        expect(host.textContent).toContain("学生答案");
        await click("返回记录列表");
        expect(host.textContent).toContain("查看批改");
    });

    it("切换试卷记录会查询 exam 类型", async () => {
        await render();
        const tab = host.querySelector<HTMLButtonElement>('[role="tab"][data-state="inactive"]')!;
        await act(async () => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false })));
        expect(mocks.get).toHaveBeenLastCalledWith("/api/admin/users/student-1/submissions", { params: { kind: "exam", page: "1", pageSize: "10" } });
    });

    it("网络失败显示错误，刷新可以恢复", async () => {
        mocks.get.mockRejectedValueOnce(new Error("offline"));
        await render();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("记录加载失败");
        await click("刷新");
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.textContent).toContain("查看批改");
    });

    it("切换用户时忽略旧请求迟到结果", async () => {
        let finishOld: (value: unknown) => void = () => {};
        mocks.get.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
        await render();
        await act(async () => root.render(<LanguageProvider><AdminUserSubmissions userId="student-2" /></LanguageProvider>));
        await act(async () => finishOld({ submissions: [], pagination: { page: 1, pageSize: 10, total: 99, totalPages: 10 } }));
        expect(host.textContent).toContain("共 1 次提交");
        expect(host.textContent).not.toContain("共 99 次提交");
    });
});

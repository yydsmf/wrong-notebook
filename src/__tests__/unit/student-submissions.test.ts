import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    startGrading: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({
    prisma: { studentSubmission: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}));
vi.mock("@/lib/student-answers", () => ({ startStudentSubmissionGrading: mocks.startGrading }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));

import { GET as GET_LATEST } from "@/app/api/student-submissions/route";
import { GET as GET_BY_ID } from "@/app/api/student-submissions/[id]/route";

const answer = (id: string, status: "pending" | "grading" | "graded" | "failed") => ({
    id,
    errorItemId: `item-${id}`,
    examQuestionId: null,
    questionText: `Question ${id}`,
    answerText: `Secret answer ${id}`,
    analysis: `Secret analysis ${id}`,
    originalImageUrl: null,
    figureSvg: null,
    imageFragments: null,
    userAnswer: "My answer",
    userAnswerImageUrl: null,
    status,
    isCorrect: status === "graded" ? false : null,
    reason: null,
    mistakeAnalysis: null,
});

const submission = {
    id: "submission-1",
    userId: "student-1",
    kind: "review",
    examPaperId: null,
    status: "failed",
    totalCount: 4,
    gradedCount: 1,
    correctCount: 0,
    createdAt: new Date("2026-11-12T00:00:00Z"),
    completedAt: null,
    answers: [answer("pending", "pending"), answer("grading", "grading"), answer("graded", "graded"), answer("failed", "failed")],
};

async function expectAnswerVisibility(response: Response) {
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answers[0]).not.toHaveProperty("answerText");
    expect(body.answers[1]).not.toHaveProperty("analysis");
    expect(body.answers[2]).toMatchObject({ answerText: "Secret answer graded", analysis: "Secret analysis graded" });
    expect(body.answers[3]).not.toHaveProperty("answerText");
}

describe("学生提交结果答案可见性", () => {
    afterEach(() => vi.clearAllMocks());

    it("单题接口只向已判分的题目返回参考答案", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "student-1", role: "user" });
        mocks.findFirst.mockResolvedValue(submission);

        const response = await GET_BY_ID(new Request("http://localhost/api/student-submissions/submission-1"), {
            params: Promise.resolve({ id: "submission-1" }),
        });

        await expectAnswerVisibility(response);
    });

    it("最近提交接口即使整批失败也只公开已判分题目的答案", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "student-1", role: "user" });
        mocks.findMany.mockResolvedValue([submission]);

        const response = await GET_LATEST(new Request("http://localhost/api/student-submissions?kind=review"));

        await expectAnswerVisibility(response);
    });

    it("重启后仍标记为判分中的提交会自动重新启动后台任务", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "student-1", role: "user" });
        mocks.findFirst.mockResolvedValue({ ...submission, status: "grading", answers: [answer("grading", "grading")] });

        await GET_BY_ID(new Request("http://localhost/api/student-submissions/submission-1"), {
            params: Promise.resolve({ id: "submission-1" }),
        });

        expect(mocks.startGrading).toHaveBeenCalledWith("submission-1");
    });
});

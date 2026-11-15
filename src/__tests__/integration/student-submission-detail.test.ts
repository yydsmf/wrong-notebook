import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), findFirst: vi.fn(), startGrading: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { studentSubmission: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/student-answers", () => ({ startStudentSubmissionGrading: mocks.startGrading }));

import { GET } from "@/app/api/student-submissions/[id]/route";

const submission = {
    id: "submission-1",
    userId: "student-1",
    kind: "review",
    examPaperId: null,
    status: "grading",
    totalCount: 1,
    gradedCount: 0,
    correctCount: 0,
    createdAt: new Date("2026-11-15T00:00:00Z"),
    completedAt: null,
    answers: [{
        id: "answer-1",
        errorItemId: "question-1",
        examQuestionId: null,
        questionText: "计算 1 + 1",
        answerText: "2",
        analysis: "把 1 与 1 相加",
        figureSvg: null,
        imageFragments: null,
        userAnswer: "0",
        userAnswerImageUrl: "data:image/png;base64,YQ==",
        status: "grading",
        isCorrect: null,
        reason: null,
        mistakeAnalysis: null,
    }],
};

const get = () => GET(new Request("http://localhost/api/student-submissions/submission-1"), {
    params: Promise.resolve({ id: "submission-1" }),
});

describe("GET /api/student-submissions/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "student-1", role: "user" });
        mocks.findFirst.mockResolvedValue(submission);
    });

    it("批改中返回学生文字和手写答案，隐藏参考答案", async () => {
        const response = await get();
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.answers[0]).toMatchObject({
            userAnswer: "0",
            userAnswerImageUrl: "data:image/png;base64,YQ==",
            status: "grading",
        });
        expect(result.answers[0]).not.toHaveProperty("answerText");
        expect(result.answers[0]).not.toHaveProperty("analysis");
        expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "submission-1", userId: "student-1" },
        }));
        expect(mocks.startGrading).toHaveBeenCalledWith("submission-1");
    });

    it("批改完成后返回参考答案，并保留学生原作答", async () => {
        mocks.findFirst.mockResolvedValue({
            ...submission,
            status: "completed",
            gradedCount: 1,
            answers: [{ ...submission.answers[0], status: "graded", isCorrect: false, reason: "计算错误" }],
        });
        const result = await (await get()).json();
        expect(result.answers[0]).toMatchObject({
            userAnswer: "0",
            answerText: "2",
            analysis: "把 1 与 1 相加",
            reason: "计算错误",
        });
        expect(mocks.startGrading).not.toHaveBeenCalled();
    });

    it("查询必须限定当前用户，找不到自己的提交时返回404", async () => {
        mocks.findFirst.mockResolvedValue(null);
        expect((await get()).status).toBe(404);
        expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "submission-1", userId: "student-1" },
        }));
    });

    it("未登录时返回401且不查询提交", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await get()).status).toBe(401);
        expect(mocks.findFirst).not.toHaveBeenCalled();
    });
});

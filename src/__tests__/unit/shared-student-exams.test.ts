import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    userFindMany: vi.fn(),
    examPaperFindMany: vi.fn(),
    examPaperFindUnique: vi.fn(),
    examPaperFindFirst: vi.fn(),
    examQuestionFindMany: vi.fn(),
    studentSubmissionFindMany: vi.fn(),
    studentSubmissionCreate: vi.fn(),
    startGrading: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findMany: mocks.userFindMany },
        examPaper: {
            findMany: mocks.examPaperFindMany,
            findUnique: mocks.examPaperFindUnique,
            findFirst: mocks.examPaperFindFirst,
        },
        examQuestion: { findMany: mocks.examQuestionFindMany },
        studentSubmission: {
            findMany: mocks.studentSubmissionFindMany,
            create: mocks.studentSubmissionCreate,
        },
    },
}));
vi.mock("@/lib/student-answers", () => ({
    getStudentAnswerOptions: vi.fn(() => ({ mode: "written", options: [] })),
    startStudentSubmissionGrading: mocks.startGrading,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/config", () => ({ getAppTimeZone: vi.fn(() => "Asia/Shanghai") }));

import { GET as LIST_EXAMS } from "@/app/api/exams/route";
import { GET as GET_EXAM } from "@/app/api/exams/[id]/route";
import { POST as SUBMIT_ANSWERS } from "@/app/api/student-submissions/route";

const examPaper = {
    id: "admin-paper-1",
    userId: "admin-1",
    title: "管理员试卷",
    status: "ready",
    scope: "all",
    difficulty: "medium",
    requestedCount: 1,
    resultsRecordedAt: null,
    createdAt: new Date("2026-11-12T00:00:00Z"),
    questions: [{
        id: "question-1",
        order: 1,
        errorItemId: "source-item-1",
        sourceShortId: "ABC123",
        status: "ready",
        questionText: "共享试题",
        answerText: "参考答案",
        analysis: "解析",
        figureSvg: null,
        imageFragments: null,
        figureScale: 100,
        figureAlign: "center",
        answerSpacePx: null,
        error: null,
        errorItem: {
            id: "source-item-1",
            originalImageUrl: "data:image/jpeg;base64,private-original",
            questionText: "这是不同的来源题干",
            imageFragments: JSON.stringify([{ id: "source-fragment", imageUrl: "data:image/png;base64,c291cmNl", order: 0 }]),
            subject: { name: "数学" },
        },
        practiceRecords: [],
    }],
};

describe("普通用户共享管理员试卷", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "student-1", role: "user", isActive: true });
        mocks.userFindMany.mockResolvedValue([{ id: "admin-1" }]);
        mocks.examPaperFindMany.mockResolvedValue([examPaper]);
        mocks.examPaperFindUnique.mockResolvedValue(examPaper);
        mocks.studentSubmissionFindMany.mockResolvedValue([]);
        mocks.examPaperFindFirst.mockResolvedValue({ id: examPaper.id });
        mocks.examQuestionFindMany.mockResolvedValue([{
            id: "question-1",
            questionText: "共享试题",
            answerText: "参考答案",
            analysis: "解析",
            figureSvg: null,
            errorItem: {
                originalImageUrl: "data:image/jpeg;base64,private-original",
                questionText: "这是不同的来源题干",
                imageFragments: JSON.stringify([{ id: "source-fragment", imageUrl: "data:image/png;base64,c291cmNl", order: 0 }]),
            },
        }]);
        mocks.studentSubmissionCreate.mockResolvedValue({ id: "submission-1" });
    });

    afterEach(() => vi.clearAllMocks());

    it("列表包含本人和启用管理员的试卷，但不扩大到其他普通用户", async () => {
        await LIST_EXAMS();

        expect(mocks.examPaperFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: { in: ["student-1", "admin-1"] } },
        }));
    });

    it("详情允许普通用户打开管理员试卷并隐藏答案及原题整图", async () => {
        const response = await GET_EXAM(new Request("http://localhost"), {
            params: Promise.resolve({ id: examPaper.id }),
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.questions[0]).toMatchObject({ questionText: "共享试题", imageFragments: [] });
        expect(body.questions[0]).not.toHaveProperty("answerText");
        expect(body.questions[0]).not.toHaveProperty("questionImageUrl");
        expect(body.questions[0]).not.toHaveProperty("originalImageUrl");
    });

    it("原题题干逐字相同时保留原题裁剪图", async () => {
        const exactPaper = {
            ...examPaper,
            questions: examPaper.questions.map((question) => ({
                ...question,
                questionText: "来源题目",
                errorItem: { ...question.errorItem, questionText: "来源题目" },
            })),
        };
        mocks.examPaperFindUnique.mockResolvedValueOnce(exactPaper);

        const response = await GET_EXAM(new Request("http://localhost"), {
            params: Promise.resolve({ id: examPaper.id }),
        });
        const body = await response.json();

        expect(body.questions[0].imageFragments).toEqual([{
            id: "source-fragment",
            imageUrl: "data:image/png;base64,c291cmNl",
            order: 0,
        }]);
    });

    it("答题提交可针对管理员共享试卷创建学生自己的提交记录", async () => {
        const request = new Request("http://localhost/api/student-submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                kind: "exam",
                examPaperId: examPaper.id,
                answers: [{ examQuestionId: "question-1", userAnswer: "我的答案" }],
            }),
        });

        const response = await SUBMIT_ANSWERS(request);

        expect(response.status).toBe(201);
        expect(mocks.examPaperFindFirst).toHaveBeenCalledWith({
            where: { id: examPaper.id, userId: { in: ["student-1", "admin-1"] } },
            select: { id: true },
        });
        expect(mocks.studentSubmissionCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: "student-1",
                examPaperId: examPaper.id,
                answers: { create: [expect.objectContaining({ originalImageUrl: null, imageFragments: null })] },
            }),
        }));
        expect(mocks.startGrading).toHaveBeenCalledWith("submission-1");
    });

    it("学生答卷快照只包含逐字相同原题的裁剪图", async () => {
        mocks.examQuestionFindMany.mockResolvedValueOnce([{
            id: "question-1",
            questionText: "来源题目",
            answerText: "参考答案",
            analysis: null,
            figureSvg: null,
            errorItem: {
                questionText: "来源题目",
                imageFragments: JSON.stringify([{ id: "source-fragment", imageUrl: "data:image/png;base64,c291cmNl", order: 0 }]),
            },
        }]);

        const response = await SUBMIT_ANSWERS(new Request("http://localhost/api/student-submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "exam", examPaperId: examPaper.id, answers: [{ examQuestionId: "question-1", userAnswer: "答案" }] }),
        }));

        expect(response.status).toBe(201);
        expect(mocks.studentSubmissionCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                answers: { create: [expect.objectContaining({
                    originalImageUrl: null,
                    imageFragments: JSON.stringify([{ id: "source-fragment", imageUrl: "data:image/png;base64,c291cmNl", order: 0 }]),
                })] },
            }),
        }));
    });

    it("不能读取另一个普通用户自己的试卷", async () => {
        mocks.examPaperFindUnique.mockResolvedValue({ ...examPaper, userId: "student-2" });

        const response = await GET_EXAM(new Request("http://localhost"), {
            params: Promise.resolve({ id: examPaper.id }),
        });

        expect(response.status).toBe(404);
    });
});

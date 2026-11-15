import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    session: vi.fn(), user: vi.fn(), count: vi.fn(), list: vi.fn(), detail: vi.fn(),
    papers: vi.fn(), paper: vi.fn(), grade: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {
    user: { findUnique: mocks.user },
    studentSubmission: { count: mocks.count, findMany: mocks.list, findFirst: mocks.detail },
    examPaper: { findMany: mocks.papers, findUnique: mocks.paper },
} }));
vi.mock("@/lib/student-answers", () => ({ startStudentSubmissionGrading: mocks.grade }));

import { GET as list } from "@/app/api/admin/users/[id]/submissions/route";
import { GET as detail } from "@/app/api/admin/users/[id]/submissions/[submissionId]/route";

const summary = {
    id: "submission-1", kind: "review", examPaperId: null, status: "completed",
    totalCount: 3, gradedCount: 3, correctCount: 2,
    createdAt: new Date("2026-11-13T01:00:00Z"), completedAt: new Date("2026-11-13T01:02:00Z"),
};
const listParams = { params: Promise.resolve({ id: "student-1" }) };
const detailParams = { params: Promise.resolve({ id: "student-1", submissionId: "submission-1" }) };
const req = (query = "") => new Request(`http://localhost/api/admin/users/student-1/submissions${query}`);

beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    mocks.user.mockResolvedValue({ id: "student-1" });
    mocks.count.mockResolvedValue(3);
    mocks.list.mockResolvedValue([summary]);
    mocks.papers.mockResolvedValue([]);
    mocks.paper.mockResolvedValue({ title: "数学测试" });
});

describe("管理员学生提交记录权限", () => {
    it.each([null, { user: { id: "student-2", role: "user" } }])("禁止未登录或普通用户访问两种接口", async (session) => {
        mocks.session.mockResolvedValue(session);
        expect((await list(req(), listParams)).status).toBe(403);
        expect((await detail(req(), detailParams)).status).toBe(403);
        expect(mocks.user).not.toHaveBeenCalled();
        expect(mocks.detail).not.toHaveBeenCalled();
    });

    it("详情必须同时限定目标用户和提交编号", async () => {
        mocks.detail.mockResolvedValue(null);
        expect((await detail(req(), detailParams)).status).toBe(404);
        expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "submission-1", userId: "student-1" } }));
    });
});

describe("管理员提交摘要与分页", () => {
    it("只读取目标用户的指定类型，列表不查询大图片和逐题答案", async () => {
        const response = await list(req("?kind=review&page=2&pageSize=2"), listParams);
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
        expect(result.submissions[0]).toMatchObject({ id: "submission-1", examTitle: null, correctCount: 2 });
        const query = mocks.list.mock.calls[0][0];
        expect(query).toMatchObject({ where: { userId: "student-1", kind: "review" }, skip: 2, take: 2, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        expect(query.select).not.toHaveProperty("answers");
        expect(query.select).not.toHaveProperty("userAnswerImageUrl");
        expect(mocks.count).toHaveBeenCalledWith({ where: { userId: "student-1", kind: "review" } });
    });

    it("试卷列表补充标题，已删除试卷保持历史记录", async () => {
        mocks.list.mockResolvedValue([{ ...summary, kind: "exam", examPaperId: "paper-1" }, { ...summary, id: "submission-2", kind: "exam", examPaperId: "deleted-paper" }]);
        mocks.papers.mockResolvedValue([{ id: "paper-1", title: "数学测试" }]);
        const response = await list(req("?kind=exam"), listParams);
        const data = await response.json();
        expect(data.submissions.map((item: { examTitle: string | null }) => item.examTitle)).toEqual(["数学测试", null]);
        expect(mocks.list.mock.calls[0][0].where).toEqual({ userId: "student-1", kind: "exam" });
    });

    it.each(["?kind=other", "?page=0", "?page=1.5", "?page=bad", "?pageSize=21", "?pageSize=0", "?page=9999999999999999"])("拒绝非法列表参数 %s", async (query) => {
        expect((await list(req(query), listParams)).status).toBe(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("不存在的用户返回 404", async () => {
        mocks.user.mockResolvedValue(null);
        expect((await list(req(), listParams)).status).toBe(404);
    });

    it("空列表返回零条分页信息", async () => {
        mocks.count.mockResolvedValue(0);
        mocks.list.mockResolvedValue([]);
        expect(await (await list(req(), listParams)).json()).toEqual({ submissions: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    });

    it("读取异常使用标准错误响应", async () => {
        mocks.list.mockRejectedValue(new Error("database unavailable"));
        expect((await list(req(), listParams)).status).toBe(500);
    });
});

describe("管理员批改详情", () => {
    it.each(["grading", "completed", "failed"])("读取 %s 的历史快照且不重新调用 AI", async (status) => {
        const answer = {
            id: "answer-1", questionText: "原题____，$\\frac{1}{2}$", answerText: "参考答案", analysis: "参考解析",
            userAnswer: "C", userAnswerImageUrl: "data:image/png;base64,YQ==", figureSvg: "<svg></svg>",
            imageFragments: "[]", status: "graded", isCorrect: false, reason: "计算错误", mistakeAnalysis: "漏看单位",
        };
        mocks.detail.mockResolvedValue({ ...summary, status, kind: "exam", examPaperId: "paper-1", _count: { answers: 7 }, answers: [answer] });
        const response = await detail(req("?page=2&pageSize=5"), detailParams);
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.answers).toEqual([answer]);
        expect(result.examTitle).toBe("数学测试");
        expect(result.pagination).toEqual({ page: 2, pageSize: 5, total: 7, totalPages: 2 });
        const select = mocks.detail.mock.calls[0][0].select;
        expect(select.answers).toMatchObject({ skip: 5, take: 5, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        expect(select.answers.select).not.toHaveProperty("originalImageUrl");
        expect(select.answers.select).not.toHaveProperty("errorItem");
        expect(mocks.grade).not.toHaveBeenCalled();
    });

    it("详情参数也限制图片分页大小", async () => {
        expect((await detail(req("?pageSize=1000"), detailParams)).status).toBe(400);
        expect(mocks.detail).not.toHaveBeenCalled();
    });

    it("详情读取异常返回 500", async () => {
        mocks.detail.mockRejectedValue(new Error("database unavailable"));
        expect((await detail(req(), detailParams)).status).toBe(500);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { id: 'user-1' },
    retry: { path: '/api/analyze', body: { imageBase64: 'data:image/jpeg;base64,AAAA', subjectId: 'nb-1', confirmBeforeImport: true, returnPath: '/notebooks/nb-1/add' }, timeoutMs: 180000 } as null | { path: string; body: Record<string, unknown>; timeoutMs?: number },
    begin: vi.fn(),
    finish: vi.fn(),
    complete: vi.fn(),
}));

vi.mock('@/lib/current-user', () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock('@/lib/api-errors', () => ({
    unauthorized: vi.fn((message: string) => Response.json({ message }, { status: 401 })),
    internalError: vi.fn((message: string) => Response.json({ message }, { status: 500 })),
    notFound: vi.fn((message: string) => Response.json({ message }, { status: 404 })),
}));
vi.mock('@/lib/background-tasks', () => ({
    BACKGROUND_TASK_REPLAY_HEADER: 'x-background-task-replay',
    BACKGROUND_TASK_REPLAY_ID_HEADER: 'x-background-task-replay-id',
    BACKGROUND_TASK_REPLAY_TOKEN: 'test-replay-token',
    beginBackgroundTaskRetry: mocks.begin,
    finishBackgroundTaskRetry: mocks.finish,
    completeBackgroundTaskRetry: mocks.complete,
}));

import { POST } from '@/app/api/tasks/[id]/retry/route';

const context = { params: Promise.resolve({ id: 'task-1' }) };

function jsonResponse(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'user-1' };
    mocks.retry = {
        path: '/api/analyze',
        body: { imageBase64: 'data:image/jpeg;base64,AAAA', subjectId: 'nb-1', confirmBeforeImport: true, returnPath: '/notebooks/nb-1/add' },
        timeoutMs: 180000,
    };
    mocks.begin.mockImplementation(() => mocks.retry);
    mocks.finish.mockReturnValue(true);
    mocks.complete.mockReturnValue(true);
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/tasks/:id/retry', () => {
    it('重试识别时保留人工校对流程，并将图片和结果回传客户端', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ questionText: '题目', answerText: '答案', analysis: '解析' }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await POST(new Request('http://localhost/api/tasks/task-1/retry', { headers: { cookie: 'session=test' } }), context);
        const result = await response.json();

        expect(response.status).toBe(200);
        expect(result.retryImport).toMatchObject({
            parsedData: { questionText: '题目' },
            imageBase64: 'data:image/jpeg;base64,AAAA',
            subjectId: 'nb-1',
            confirmBeforeImport: true,
            returnPath: '/notebooks/nb-1/add',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
            cookie: 'session=test',
            'x-background-task-replay': 'test-replay-token',
            'x-background-task-replay-id': 'task-1',
        });
        expect(mocks.complete).toHaveBeenCalledWith('user-1', 'task-1');
        expect(mocks.finish).not.toHaveBeenCalled();
    });

    it('关闭人工确认时把识别结果交回原导入流程保存', async () => {
        mocks.retry = {
            path: '/api/analyze',
            body: { imageBase64: 'data:image/jpeg;base64,AAAA', subjectId: 'nb-1', confirmBeforeImport: false },
        };
        mocks.begin.mockImplementation(() => mocks.retry);
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ questionText: '题目', subject: '数学' }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await POST(new Request('http://localhost/api/tasks/task-1/retry'), context);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ retryImport: {
            parsedData: { questionText: '题目' },
            imageBase64: 'data:image/jpeg;base64,AAAA',
            subjectId: 'nb-1',
            confirmBeforeImport: false,
            returnPath: '/',
        } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mocks.complete).toHaveBeenCalledWith('user-1', 'task-1');
    });

    it('认证失败时不启动重试', async () => {
        mocks.user = null as never;
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const response = await POST(new Request('http://localhost/api/tasks/task-1/retry'), context);

        expect(response.status).toBe(401);
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

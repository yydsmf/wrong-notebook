/**
 * 题目导入流程：免确认直接入库、人工校对后保存、文字解题与识别失败提示
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { useQuestionImport } from '@/lib/use-question-import';
import { translations } from '@/lib/translations';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    push: vi.fn(),
    confirmBeforeImport: false,
    saveParsedQuestion: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    prepareImage: vi.fn(),
    renderRegion: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/question-import', () => ({
    fetchConfirmBeforeImport: vi.fn(async () => mocks.confirmBeforeImport),
    saveParsedQuestion: mocks.saveParsedQuestion,
}));
vi.mock('@/lib/image-utils', () => ({ processImageFile: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }));
vi.mock('@/lib/image-pipeline', () => ({
    prepareImage: mocks.prepareImage,
    renderRegion: mocks.renderRegion,
    ImageDecodeError: class extends Error {},
}));
vi.mock('@/lib/feedback', () => ({ toast: { error: mocks.toastError, info: mocks.toastInfo, success: mocks.toastSuccess, warning: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const parsed = { questionText: '1 + 1 = ?', answerText: '2', analysis: '加法', knowledgePoints: ['加法'], subject: '数学', requiresImage: false };

type Flow = ReturnType<typeof useQuestionImport>;
type Options = Parameters<typeof useQuestionImport>[0];

let root: Root;
let container: HTMLDivElement;
let flow: Flow;

// 每次渲染后把 hook 的最新返回值交给测试
function Probe({ options, onRender }: { options: Options; onRender: (value: Flow) => void }) {
    const value = useQuestionImport(options);
    useEffect(() => onRender(value));
    return null;
}

async function render(options: Partial<Options> = {}) {
    await act(async () => {
        root.render(<LanguageProvider><Probe options={{ logPrefix: '[Test]', ...options }} onRender={(value) => { flow = value; }} /></LanguageProvider>);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmBeforeImport = false;
    mocks.get.mockResolvedValue({ timeouts: { analyze: 120000 } });
    mocks.saveParsedQuestion.mockResolvedValue({ id: 'saved', duplicate: false });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('题目导入流程', () => {
    it('多选图片单题裁剪，全部确认后只识别一次并将所有原图存到同一道题', async () => {
        const first = new File(['first'], 'first.png', { type: 'image/png' });
        const second = new File(['second'], 'second.png', { type: 'image/png' });
        const region = { x: 0, y: 0, width: 1, height: 1 };
        mocks.prepareImage
            .mockResolvedValueOnce({ previewUrl: 'blob:first', dispose: vi.fn() })
            .mockResolvedValueOnce({ previewUrl: 'blob:second', dispose: vi.fn() });
        mocks.renderRegion
            .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,QQ==' })
            .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,Qg==' });
        mocks.post.mockResolvedValueOnce(parsed);
        await render();
        await act(async () => flow.selectImages([first, second]));
        expect(flow.croppingImage).toBe('blob:first');
        await act(async () => flow.cropRegions([region], false));
        expect(flow.croppingImage).toBe('blob:second');
        expect(flow.batchBlobs).toBeNull();
        expect(mocks.post).not.toHaveBeenCalled();
        await act(async () => flow.cropRegions([region], false));
        expect(flow.batchBlobs).toBeNull();
        expect(flow.isCropperOpen).toBe(false);
        expect(flow.isBusy).toBe(false);
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/analyze', expect.objectContaining({
            images: ['data:image/png;base64,QQ==', 'data:image/png;base64,Qg=='],
        }), expect.any(Object));
        expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('imageBase64');
        expect(mocks.saveParsedQuestion).toHaveBeenCalledExactlyOnceWith(parsed, {
            subjectId: undefined, imageUrls: ['data:image/png;base64,QQ==', 'data:image/png;base64,Qg=='],
        });
    });

    it('主动选择多题框选才进入批量导入，各张图的框保留顺序', async () => {
        const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')];
        mocks.prepareImage.mockResolvedValueOnce({ previewUrl: 'blob:a', dispose: vi.fn() }).mockResolvedValueOnce({ previewUrl: 'blob:b', dispose: vi.fn() });
        mocks.renderRegion.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,QQ==' }).mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,Qg==' });
        const region = { x: 0, y: 0, width: 1, height: 1 };
        await render();
        await act(async () => flow.selectImages(files));
        await act(async () => flow.cropRegions([region], true));
        expect(flow.cropMode).toBe('multi');
        await act(async () => flow.cropRegions([region], true));
        expect(flow.batchBlobs).toHaveLength(2);
        expect(await Promise.all(flow.batchBlobs!.map(blob => blob.text()))).toEqual(['A', 'B']);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
    });

    it('单选图片裁剪后仍使用既有单题识别与保存逻辑', async () => {
        mocks.prepareImage.mockResolvedValueOnce({ previewUrl: 'blob:first', dispose: vi.fn() });
        mocks.renderRegion.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,QQ==' });
        mocks.post.mockResolvedValueOnce(parsed);
        await render({ importSubjectId: 'nb-1' });
        await act(async () => flow.selectImages([new File(['first'], 'first.png', { type: 'image/png' })]));
        await act(async () => flow.cropRegions([{ x: 0, y: 0, width: 1, height: 1 }], false, 90));
        expect(mocks.post).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({ imageBase64: 'data:image/png;base64,QQ==' }), expect.any(Object));
        expect(mocks.saveParsedQuestion).toHaveBeenCalledWith(parsed, { subjectId: 'nb-1', imageUrls: ['data:image/png;base64,QQ=='] });
        expect(flow.batchBlobs).toBeNull();
        expect(flow.lastImported).toEqual({ id: 'saved', duplicate: false });
    });

    it('未开启人工确认时识别后直接入库，不进入校对页', async () => {
        const onParsed = vi.fn();
        mocks.post.mockResolvedValueOnce({ ...parsed, importedQuestion: { id: 'server-saved', shortId: 'q1', subjectId: 'nb-1', notebookName: '数学' } });
        await render({ analyzeSubjectId: 'nb-1', importSubjectId: 'nb-1', onParsed });

        await act(async () => flow.cropComplete(new Blob(['x'])));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

        expect(mocks.post).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({ imageBase64: 'data:image/jpeg;base64,AAAA', subjectId: 'nb-1', autoSave: true, returnPath: '/?notebook=nb-1' }), expect.objectContaining({ timeout: 120000, recoverable: true, onProgress: expect.any(Function) }));
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
        expect(flow.lastImported).toEqual({ id: 'server-saved', shortId: 'q1', subjectId: 'nb-1', notebookName: '数学' });
        expect(flow.step).toBe('upload');
        expect(onParsed).not.toHaveBeenCalled();
        expect(flow.analysisStep).toBe('idle');
    });

    it('前台等待 1 分钟后只关闭遮罩，请求仍可在后台完成', async () => {
        vi.useFakeTimers();
        let resolve!: (value: unknown) => void;
        mocks.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
        await render({ analyzeSubjectId: 'nb-1' });

        await act(async () => flow.cropComplete(new Blob(['x'])));
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(flow.analysisStep).toBe('idle');
        expect(mocks.toastInfo).toHaveBeenCalled();

        await act(async () => {
            resolve({ ...parsed, importedQuestion: { id: 'background-saved', shortId: 'q2', subjectId: 'nb-1', notebookName: '数学' } });
            await Promise.resolve();
        });
        expect(flow.lastImported).toMatchObject({ id: 'background-saved' });
        vi.useRealTimers();
    });

    it('开启人工确认时进入校对页，保存到固定错题本后跳转', async () => {
        mocks.confirmBeforeImport = true;
        const onParsed = vi.fn();
        mocks.post.mockResolvedValueOnce(parsed);
        await render({ fixedSubjectId: 'nb-2', onParsed });

        await act(async () => flow.cropComplete(new Blob(['x'])));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
        expect(flow.step).toBe('review');
        expect(flow.parsedData).toEqual(parsed);
        expect(flow.currentImage).toBe('data:image/jpeg;base64,AAAA');
        expect(onParsed).toHaveBeenCalledWith(parsed);

        mocks.post.mockResolvedValueOnce({ id: 'item-1' });
        await act(async () => flow.saveReviewed({ ...parsed, subjectId: 'other' } as never));
        expect(mocks.post).toHaveBeenLastCalledWith('/api/error-items', expect.objectContaining({ subjectId: 'nb-2', originalImageUrl: 'data:image/jpeg;base64,AAAA' }));
        expect(mocks.push).toHaveBeenCalledWith('/notebooks/nb-2');
        expect(flow.step).toBe('upload');
    });

    it('从后台任务恢复的识别结果进入原校对页，不受当前偏好加载时序影响', async () => {
        const onParsed = vi.fn();
        sessionStorage.setItem('background-task-retry-import', JSON.stringify({
            parsedData: parsed,
            imageBase64: 'data:image/jpeg;base64,RETRIED',
            images: ['data:image/jpeg;base64,RETRIED', 'data:image/png;base64,SECOND'],
            subjectId: 'nb-4',
            confirmBeforeImport: true,
        }));

        await render({ fixedSubjectId: 'nb-4', onParsed });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

        expect(flow.step).toBe('review');
        expect(flow.parsedData).toEqual(parsed);
        expect(flow.currentImage).toBe('data:image/jpeg;base64,RETRIED');
        expect(flow.currentImages).toEqual(['data:image/jpeg;base64,RETRIED', 'data:image/png;base64,SECOND']);
        expect(onParsed).toHaveBeenCalledWith(parsed);
        expect(sessionStorage.getItem('background-task-retry-import')).toBeNull();
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
        mocks.post.mockResolvedValueOnce({ id: 'saved' });
        await act(async () => flow.saveReviewed(parsed as never));
        expect(mocks.post).toHaveBeenLastCalledWith('/api/error-items', expect.objectContaining({ originalImageUrls: ['data:image/jpeg;base64,RETRIED', 'data:image/png;base64,SECOND'] }));
        expect(mocks.post.mock.calls.at(-1)?.[1]).not.toHaveProperty('originalImageUrl');
    });

    it('后台识别重试关闭人工确认时调用原有直接保存流程', async () => {
        sessionStorage.setItem('background-task-retry-import', JSON.stringify({
            parsedData: parsed,
            imageBase64: 'data:image/jpeg;base64,RETRIED',
            subjectId: 'nb-4',
            confirmBeforeImport: false,
        }));

        await render({ importSubjectId: 'nb-4' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

        expect(mocks.saveParsedQuestion).toHaveBeenCalledWith(parsed, { subjectId: 'nb-4', imageUrls: ['data:image/jpeg;base64,RETRIED'] });
        expect(flow.step).toBe('upload');
        expect(flow.lastImported).toEqual({ id: 'saved', duplicate: false });
    });

    it('保存时识别为重复题则跳到原题', async () => {
        await render();
        mocks.post.mockResolvedValueOnce({ id: 'existing', duplicate: true });
        await act(async () => { await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' }); });
        expect(mocks.push).toHaveBeenCalledWith('/error-items/existing');
    });

    it('直接保存失败保留具体原因，不跳转，重试成功后清除原因', async () => {
        await render();
        mocks.post.mockRejectedValueOnce({ status: 502, data: {
            message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason: 'AI_AUTH_ERROR' },
        } });
        await act(async () => { expect(await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' })).toBe(false); });
        expect(flow.saveError).toContain(translations.zh.errors.QUESTION_SAVE_GRADE_FAILED);
        expect(flow.saveError).toContain(translations.zh.errors.AI_AUTH_ERROR);
        expect(mocks.toastError).toHaveBeenCalledWith(flow.saveError);
        expect(mocks.push).not.toHaveBeenCalled();

        mocks.post.mockResolvedValueOnce({ id: 'saved' });
        await act(async () => { expect(await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' })).toBe(true); });
        expect(flow.saveError).toBeNull();
        expect(mocks.push).toHaveBeenCalledWith('/notebooks/nb-1');
    });

    it('每日额度失败保留提示，由 apiClient 统一弹窗，避免重复弹窗', async () => {
        await render();
        mocks.post.mockRejectedValueOnce({ status: 429, data: { message: 'AI_DAILY_LIMIT_EXCEEDED' } });
        await act(async () => { await flow.saveQuestion({ questionText: 'q' }); });
        expect(flow.saveError).toContain(translations.zh.errors.AI_DAILY_LIMIT_EXCEEDED);
        expect(mocks.toastError).not.toHaveBeenCalled();
        await act(async () => flow.dismissSaveError());
        expect(flow.saveError).toBeNull();
    });

    it('文字解题带上错题本，并规范化作答状态', async () => {
        mocks.confirmBeforeImport = true;
        mocks.post.mockResolvedValueOnce({ answerText: '2', analysis: '加法', knowledgePoints: ['加法'], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'bogus' });
        await render({ textNotebook: { id: 'nb-3', name: '数学' } });

        await act(async () => { await flow.submitText('1 + 1 = ?'); });
        expect(mocks.post).toHaveBeenCalledWith('/api/reanswer', expect.objectContaining({ questionText: '1 + 1 = ?', subject: '数学', subjectId: 'nb-3' }), expect.objectContaining({ timeout: 120000, recoverable: true, onProgress: expect.any(Function) }));
        expect(flow.parsedData).toMatchObject({ questionText: '1 + 1 = ?', mistakeStatus: 'unknown', subject: '其他' });
        expect(flow.currentImage).toBeNull();
    });

    it('识别失败时提示错误并恢复空闲状态', async () => {
        mocks.post.mockRejectedValueOnce(new Error('boom'));
        await render();
        await act(async () => flow.cropComplete(new Blob(['x'])));
        await act(async () => {});
        expect(mocks.toastError).toHaveBeenCalled();
        expect(flow.analysisStep).toBe('idle');
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
    });
});

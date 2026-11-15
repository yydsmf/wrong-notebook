import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { ImageRegion } from '@/lib/image-crop';
import type { PreparedImage } from '@/lib/image-pipeline';
import { useImageCropQueue } from '@/lib/use-image-crop-queue';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), render: vi.fn(), complete: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/image-pipeline', () => ({
    prepareImage: mocks.prepare,
    renderRegion: mocks.render,
    ImageDecodeError: class extends Error {},
}));
vi.mock('@/lib/feedback', () => ({ toast: { error: mocks.error } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

type Queue = ReturnType<typeof useImageCropQueue>;
const region: ImageRegion = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
const files = [1, 2, 3].map((index) => new File([String(index)], `${index}.png`, { type: 'image/png' }));
const sources = files.map((file) => ({ previewUrl: `blob:${file.name}`, dispose: vi.fn() } as unknown as PreparedImage));
let queue: Queue;
let root: Root;
let host: HTMLDivElement;

function Probe() {
    const value = useImageCropQueue({ logPrefix: '[Test]', onComplete: mocks.complete });
    useEffect(() => { queue = value; });
    return null;
}

beforeEach(async () => {
    vi.resetAllMocks();
    mocks.prepare.mockImplementation(async (file: File) => sources[files.indexOf(file)]);
    mocks.render.mockImplementation(async (source: PreparedImage) => ({ dataUrl: `data:${source.previewUrl}` }));
    mocks.complete.mockResolvedValue(undefined);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<LanguageProvider><Probe /></LanguageProvider>));
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

describe('多图裁剪队列', () => {
    it('逐张裁剪三张图片，保留顺序和各自旋转，全部确认后才统一交给导入', async () => {
        await act(async () => queue.selectImages(files));
        expect(queue.cropPosition).toEqual({ current: 1, total: 3 });
        expect(mocks.prepare).toHaveBeenCalledTimes(1);

        await act(async () => queue.cropRegions([region], false, 90));
        expect(queue.croppingImage).toBe('blob:2.png');
        expect(queue.cropPosition).toEqual({ current: 2, total: 3 });
        expect(sources[0].dispose).toHaveBeenCalledTimes(1);
        expect(mocks.complete).not.toHaveBeenCalled();

        await act(async () => queue.cropRegions([region], false, 0));
        expect(queue.cropPosition).toEqual({ current: 3, total: 3 });
        expect(mocks.complete).not.toHaveBeenCalled();
        await act(async () => queue.cropRegions([region], false, 270));

        expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(['data:blob:1.png', 'data:blob:2.png', 'data:blob:3.png'], false);
        expect(mocks.render).toHaveBeenNthCalledWith(1, sources[0], region, 90);
        expect(mocks.render).toHaveBeenNthCalledWith(2, sources[1], region, 0);
        expect(mocks.render).toHaveBeenNthCalledWith(3, sources[2], region, 270);
        expect(queue.croppingImage).toBeNull();
        expect(queue.isProcessing).toBe(false);
        sources.forEach((source) => expect(source.dispose).toHaveBeenCalledTimes(1));
    });

    it('一张图框选多题与多张图混合时，所有框按顺序进入同一批次', async () => {
        await act(async () => queue.selectImages(files.slice(0, 2)));
        mocks.render.mockResolvedValueOnce({ dataUrl: 'first-a' }).mockResolvedValueOnce({ dataUrl: 'first-b' }).mockResolvedValueOnce({ dataUrl: 'second' });
        const secondRegion = { ...region, x: 0.5 };
        await act(async () => queue.cropRegions([region, secondRegion], true, 180));
        expect(queue.cropMode).toBe('multi');
        await act(async () => queue.cropRegions([region], true));
        expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(['first-a', 'first-b', 'second'], true);
        expect(mocks.render).toHaveBeenNthCalledWith(2, sources[0], secondRegion, 180);
    });

    it('区域数量不会自动决定题目数量，单题模式多个区域仍属于同题', async () => {
        await act(async () => queue.selectImages(files.slice(0, 1)));
        mocks.render.mockResolvedValueOnce({ dataUrl: 'part-a' }).mockResolvedValueOnce({ dataUrl: 'part-b' });
        await act(async () => queue.cropRegions([region, { ...region, x: 0.5 }], false));
        expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(['part-a', 'part-b'], false);
    });

    it('单张单题仍走原有识别流程，单张多题仍走批量流程', async () => {
        await act(async () => queue.selectImages(files.slice(0, 1)));
        await act(async () => queue.cropRegions([region], false));
        expect(mocks.complete).toHaveBeenLastCalledWith(['data:blob:1.png'], false);
        await act(async () => queue.selectImages(files.slice(0, 1)));
        await act(async () => queue.cropRegions([region], true));
        expect(mocks.complete).toHaveBeenLastCalledWith(['data:blob:1.png'], true);
    });

    it('中途取消会清空已裁剪结果，下次选择不会混入旧图片', async () => {
        await act(async () => queue.selectImages(files));
        await act(async () => queue.cropRegions([region], false));
        await act(async () => queue.closeCropper());
        expect(mocks.complete).not.toHaveBeenCalled();
        expect(sources[1].dispose).toHaveBeenCalledTimes(1);
        await act(async () => queue.selectImages(files.slice(2)));
        await act(async () => queue.cropRegions([region], false));
        expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(['data:blob:3.png'], false);
    });

    it('下一张读取失败保留当前图，重试后没有重复或遗漏', async () => {
        await act(async () => queue.selectImages(files.slice(0, 2)));
        mocks.prepare.mockRejectedValueOnce(new Error('读取失败'));
        await act(async () => queue.cropRegions([region], false));
        expect(queue.croppingImage).toBe('blob:1.png');
        expect(queue.cropPosition).toEqual({ current: 1, total: 2 });
        expect(sources[0].dispose).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalled();
        await act(async () => queue.cropRegions([region], false));
        await act(async () => queue.cropRegions([region], false));
        expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(['data:blob:1.png', 'data:blob:2.png'], false);
    });

    it('快速重复确认只处理一次，取消后正在读取的下一张不会重新打开弹窗', async () => {
        await act(async () => queue.selectImages(files.slice(0, 2)));
        let resolve!: (value: PreparedImage) => void;
        mocks.prepare.mockImplementationOnce(() => new Promise<PreparedImage>((done) => { resolve = done; }));
        let pending!: Promise<void>;
        await act(async () => {
            pending = queue.cropRegions([region], false);
            await queue.cropRegions([region], false);
        });
        expect(mocks.render).toHaveBeenCalledTimes(1);
        expect(queue.isProcessing).toBe(true);
        await act(async () => queue.closeCropper());
        await act(async () => { resolve(sources[1]); await pending; });
        expect(queue.croppingImage).toBeNull();
        expect(sources[1].dispose).toHaveBeenCalledTimes(1);
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it('换一批图片后，旧批次迟到的读取结果被释放且不会覆盖新图', async () => {
        let resolve!: (value: PreparedImage) => void;
        mocks.prepare.mockImplementationOnce(() => new Promise<PreparedImage>((done) => { resolve = done; }));
        let pending!: Promise<void>;
        await act(async () => { pending = queue.selectImages(files); });
        await act(async () => queue.selectImages(files.slice(2)));
        await act(async () => { resolve(sources[0]); await pending; });
        expect(queue.croppingImage).toBe('blob:3.png');
        expect(queue.cropPosition).toEqual({ current: 1, total: 1 });
        expect(sources[0].dispose).toHaveBeenCalledTimes(1);
        expect(sources[2].dispose).not.toHaveBeenCalled();
    });
});

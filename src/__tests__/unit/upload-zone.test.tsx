import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadZone } from '@/components/upload-zone';
import { LanguageProvider } from '@/contexts/LanguageContext';

const files = ['first.png', 'second.png', 'third.png'].map((name) => new File(['image'], name, { type: 'image/png' }));
let root: Root;
let host: HTMLDivElement;
const onImagesSelect = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

async function render(isAnalyzing = false) {
    await act(async () => root.render(
        <LanguageProvider><UploadZone onImagesSelect={onImagesSelect} isAnalyzing={isAnalyzing} /></LanguageProvider>,
    ));
}

describe('多图上传入口', () => {
    it('文件选择器允许多选，按顺序把全部图片交给裁剪流程', async () => {
        await render();
        const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(input.multiple).toBe(true);
        Object.defineProperty(input, 'files', { value: files });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        expect(onImagesSelect).toHaveBeenCalledExactlyOnceWith(files);
    });

    it('一次粘贴多张图片时不会只保留第一张', async () => {
        await render();
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: {
            items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        } });
        await act(async () => document.body.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(true);
        expect(onImagesSelect).toHaveBeenCalledExactlyOnceWith(files);
    });

    it('忙碌时禁止选择和粘贴，避免替换正在处理的批次', async () => {
        await render(true);
        expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: {
            items: [{ kind: 'file', type: files[0].type, getAsFile: () => files[0] }],
        } });
        await act(async () => document.body.dispatchEvent(event));
        expect(onImagesSelect).not.toHaveBeenCalled();
    });
});

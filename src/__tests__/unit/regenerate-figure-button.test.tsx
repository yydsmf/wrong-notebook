import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegenerateFigureButton } from '@/components/regenerate-figure-button';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/feedback';

vi.mock('@/lib/api-client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('重新生成配图的结果反馈', () => {
    it('无可用图时提示旧图已保留，不触发页面更新，并允许重试', async () => {
        vi.mocked(apiClient.post).mockRejectedValue({ data: { message: 'NO_FIGURE_GENERATED' } });
        const onDone = vi.fn();
        await act(async () => root.render(<LanguageProvider><RegenerateFigureButton errorItemId="e1" onDone={onDone} /></LanguageProvider>));

        await act(async () => container.querySelector('button')!.click());

        expect(onDone).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('AI 未返回可用配图，现有配图已保留。');
        expect(container.querySelector('button')!.disabled).toBe(false);
    });

    it('可用配图沿用原有成功更新流程', async () => {
        const figure = { hasFigure: true, figureSvg: '<svg xmlns="http://www.w3.org/2000/svg"><text>新图</text></svg>' };
        vi.mocked(apiClient.post).mockResolvedValue(figure);
        const onDone = vi.fn();
        await act(async () => root.render(<LanguageProvider><RegenerateFigureButton errorItemId="e1" onDone={onDone} /></LanguageProvider>));

        await act(async () => container.querySelector('button')!.click());

        expect(onDone).toHaveBeenCalledWith(figure);
        expect(toast.error).not.toHaveBeenCalled();
        expect(container.querySelector('button')!.disabled).toBe(false);
    });
});

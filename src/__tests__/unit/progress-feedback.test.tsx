import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressFeedback } from '@/components/ui/progress-feedback';
import type { ProgressStatus } from '@/components/ui/progress-feedback';
import { LanguageProvider } from '@/contexts/LanguageContext';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T04:00:00Z'));
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

async function renderStatus(status: ProgressStatus, timeoutMs?: number, progress?: number) {
    await act(async () => root.render(
        <StrictMode><LanguageProvider><ProgressFeedback status={status} timeoutMs={timeoutMs} progress={progress} /></LanguageProvider></StrictMode>,
    ));
}

const estimatedProgress = () => container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow');
const elapsed = () => container.querySelector('[role="timer"]')?.textContent;
const advance = (seconds: number) => act(() => vi.advanceTimersByTime(seconds * 1000));

describe('按阶段估算进度并显示实际用时', () => {
    it('空闲时不显示遮罩，也不启动计时器', async () => {
        await renderStatus('idle');
        expect(container.textContent).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['compressing', '10', '正在准备图片...'],
        ['uploading', '20', '正在上传...'],
        ['analyzing', '25', 'AI 正在读取题目并生成解析...'],
        ['processing', '85', '正在整理分析结果...'],
        ['saving', '95', '正在保存...'],
    ] as const)('%s 阶段显示估算值 %s%% 和对应状态', async (status, percent, message) => {
        await renderStatus(status);
        expect(estimatedProgress()).toBe(percent);
        expect(container.textContent).toContain(`阶段估算：${percent}%`);
        expect(container.textContent).toContain(message);
        expect(container.textContent).toContain('百分比按处理阶段估算。');
        expect(elapsed()).toBe('已用时：00:00');
    });

    it('等待 AI 时按超时时间平滑增加估算进度，不固定停在一个百分比', async () => {
        await renderStatus('analyzing', 180000);
        advance(150);
        expect(estimatedProgress()).toBe('71');
        expect(elapsed()).toBe('已用时：02:30');
        expect(container.textContent).not.toContain('100%');
        expect(vi.getTimerCount()).toBe(1);
    });

    it('优先显示服务端上报的真实阶段估算值', async () => {
        await renderStatus('waiting', undefined, 47);
        expect(estimatedProgress()).toBe('47');
        expect(container.textContent).toContain('正在等待 AI 返回分析结果...');
    });

    it('切换阶段不重置用时，不在保存完成前显示 100%', async () => {
        await renderStatus('compressing');
        advance(3);
        await renderStatus('analyzing');
        advance(12);
        expect(elapsed()).toBe('已用时：00:15');
        await renderStatus('processing');
        expect(estimatedProgress()).toBe('85');
        expect(elapsed()).toBe('已用时：00:15');
        await renderStatus('saving');
        advance(2);
        expect(estimatedProgress()).toBe('95');
        expect(elapsed()).toBe('已用时：00:17');
        expect(container.textContent).not.toContain('100%');
        expect(vi.getTimerCount()).toBe(1);
    });

    it('结束后清理计时器，新任务从零开始计时', async () => {
        await renderStatus('analyzing');
        advance(7);
        await renderStatus('idle');
        expect(container.textContent).toBe('');
        expect(vi.getTimerCount()).toBe(0);
        advance(30);
        await renderStatus('analyzing');
        expect(elapsed()).toBe('已用时：00:00');
        advance(2);
        expect(elapsed()).toBe('已用时：00:02');
    });

    it('页面暂停计时回调后，恢复时按实际经过的时间更新', async () => {
        await renderStatus('analyzing');
        vi.setSystemTime(new Date('2026-10-19T04:01:00Z'));
        advance(1);
        expect(elapsed()).toBe('已用时：01:01');
        expect(estimatedProgress()).toBe('44');
    });

    it('长任务使用时分秒格式，英文界面也明确标注估算', async () => {
        localStorage.setItem('app-language', 'en');
        await renderStatus('analyzing');
        advance(3615);
        expect(container.textContent).toContain('AI is reading the question and generating the analysis...');
        expect(container.textContent).toContain('Stage estimate: 80%');
        expect(elapsed()).toBe('Elapsed: 01:00:15');
    });
});

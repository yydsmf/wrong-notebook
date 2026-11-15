import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTasksButton } from '@/components/background-tasks-button';
import { apiClient } from '@/lib/api-client';
import type { BackgroundTask } from '@/lib/background-tasks';

const state = vi.hoisted(() => ({ pathname: '/', mustChangePassword: false }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { role: 'admin', mustChangePassword: state.mustChangePassword } } }) }));
vi.mock('@/contexts/LanguageContext', async () => {
    const { translations } = await import('@/lib/translations');
    return { useLanguage: () => ({ t: translations.zh }) };
});
vi.mock('@/contexts/TimeZoneContext', () => ({ useTimeZone: () => ({ timeZone: 'Asia/Shanghai' }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.mocked(apiClient.get).mockReset();
    state.pathname = '/';
    state.mustChangePassword = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function showButton() {
    await act(async () => root.render(<BackgroundTasksButton />));
    await act(async () => vi.advanceTimersByTimeAsync(1));
}

describe('后台任务按钮的向导与响应保护', () => {
    it.each([
        { pathname: '/setup', mustChangePassword: false },
        { pathname: '/', mustChangePassword: true },
    ])('向导或改密前不显示按钮、不轮询：$pathname $mustChangePassword', async (input) => {
        Object.assign(state, input);
        await showButton();
        expect(container.querySelector('button')).toBeNull();
        expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('空对象响应不使任务列表渲染崩溃', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({});
        await showButton();
        expect(apiClient.get).toHaveBeenCalledWith('/api/tasks');
        expect(container.querySelector('button')).not.toBeNull();
    });

    it('异常轮询响应保留上次有效的任务数量', async () => {
        const task: BackgroundTask = { id: 't1', kind: 'analyze', status: 'running', subject: null, progress: null,
            error: null, canRetry: false, link: null, startedAt: '2026-11-15T00:00:00Z', finishedAt: null };
        vi.mocked(apiClient.get).mockResolvedValueOnce({ tasks: [task] }).mockResolvedValue({});
        await showButton();
        expect(container.querySelector('button')?.textContent).toBe('1');
        await act(async () => vi.advanceTimersByTimeAsync(15000));
        expect(apiClient.get).toHaveBeenCalledTimes(2);
        expect(container.querySelector('button')?.textContent).toBe('1');
    });
});

import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai-timeout';

const deadlines = new AsyncLocalStorage<AbortSignal>();

export function getAIRequestSignal(): AbortSignal | undefined {
    return deadlines.getStore();
}

/** 整次调用共用预算，包含排队、流读取及输出截断重试。 */
export async function withAIRequestDeadline<T>(operation: () => Promise<T>, timeout = DEFAULT_AI_TIMEOUT_MS): Promise<T> {
    if (deadlines.getStore()) return operation();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error('AI_TIMEOUT_ERROR');
            controller.abort(error);
            reject(error);
        }, timeout);
    });
    try {
        return await deadlines.run(controller.signal, () => Promise.race([operation(), expired]));
    } finally {
        clearTimeout(timer);
    }
}

/** 前后端共用的 AI 等待预算，普通数据接口仍使用各自的短超时。 */
export const DEFAULT_AI_TIMEOUT_MS = 10 * 60 * 1000;

export function resolveAiTimeout(value?: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(value, DEFAULT_AI_TIMEOUT_MS)
        : DEFAULT_AI_TIMEOUT_MS;
}

const STORAGE_KEY = 'background-task-retry-import';
let pending: string | null = null;

/** 跨页面交接识别结果；多张高清图超过浏览器存储额度时仍可在本次导航中继续导入。 */
export function storeRetryImport(payload: unknown): void {
    const raw = JSON.stringify(payload);
    pending = raw;
    try {
        sessionStorage.setItem(STORAGE_KEY, raw);
    } catch {
        // 内存保留完整结果，清除可能残留的上一题，避免取到旧数据。
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* 浏览器可能禁用存储。 */ }
    }
}

export function takeRetryImport(): string | null {
    let raw = pending;
    pending = null;
    try {
        raw ??= sessionStorage.getItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* 存储不可用时使用本次会话内存。 */ }
    return raw;
}

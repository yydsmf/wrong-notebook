import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeRetryImport, takeRetryImport } from '@/lib/retry-import-transfer';

beforeEach(() => { takeRetryImport(); sessionStorage.clear(); });
afterEach(() => { takeRetryImport(); vi.restoreAllMocks(); });

describe('多图识别重试跨页交接', () => {
    it('结果只消费一次，所有图片完整传递', () => {
        const payload = { images: ['first', 'second'], parsedData: { questionText: '跨页题' } };
        storeRetryImport(payload);
        expect(JSON.parse(takeRetryImport()!)).toEqual(payload);
        expect(takeRetryImport()).toBeNull();
        expect(sessionStorage.getItem('background-task-retry-import')).toBeNull();
    });
    it('多图超过存储额度时仍可继续，并清除旧题的残留', () => {
        sessionStorage.setItem('background-task-retry-import', 'old');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
        storeRetryImport({ images: ['page1', 'page2'] });
        expect(sessionStorage.getItem('background-task-retry-import')).toBeNull();
        expect(JSON.parse(takeRetryImport()!)).toEqual({ images: ['page1', 'page2'] });
    });
    it('兼容刷新前写入的单图识别结果', () => {
        sessionStorage.setItem('background-task-retry-import', 'legacy');
        expect(takeRetryImport()).toBe('legacy');
        expect(takeRetryImport()).toBeNull();
    });
});

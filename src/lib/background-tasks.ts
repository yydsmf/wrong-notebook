/**
 * 后台耗时事务登记：识别题目、生成动画讲解、重新解题、批量标注、生成试卷等调用 AI 的操作
 * 开始时登记，结束时标记成功或失败，供页面「后台任务」弹框查询进度。
 *
 * 登记表保存在进程内存中（生产环境为单个容器），并在变化后写入配置目录的 background-tasks.json：
 * 服务重启后仍能看到最近结束的事务；重启时还在进行的事务（AI 调用已随进程中断）标记为失败，提示用户重新操作。
 * 已结束的事务保留一段时间后自动清理。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@/lib/logger";
import { DEFAULT_AI_TIMEOUT_MS } from './ai-timeout';

const logger = createLogger('background-tasks');

export type BackgroundTaskKind =
    | 'analyze'          // 识别题目图片
    | 'batch_upload'     // Openclaw 批量上传识别
    | 'data_import'      // 导入备份数据
    | 'svg_animation'    // 生成 SVG 动画讲解
    | 'svg_narration'    // 补写动画的语音讲解稿
    | 'tts_voice'        // 合成动画讲解的云端语音
    | 'reanswer'         // 重新生成解答
    | 'fix_latex'        // 修复 LaTeX
    | 'figure'           // 重绘配图
    | 'geogebra'         // 生成 GeoGebra 演示
    | 'retag'            // 重新生成知识点（单题）
    | 'retag_notebook'   // 错题本批量重新生成知识点
    | 'practice'         // 生成举一反三题目
    | 'exam';            // 生成试卷

export type BackgroundTaskStatus = 'running' | 'succeeded' | 'failed';

export interface BackgroundTask {
    id: string;
    kind: BackgroundTaskKind;
    /** 操作对象的说明，如题目编号和题干开头、错题本名、试卷标题 */
    subject: string | null;
    status: BackgroundTaskStatus;
    /** 批量事务的进度 */
    progress: { done: number; total: number; failed: number } | null;
    error: string | null;
    canRetry: boolean;
    canResume?: boolean;
    /** 可跳转查看的页面 */
    link: string | null;
    startedAt: string;
    finishedAt: string | null;
}

interface StoredTask extends BackgroundTask {
    userId: string;
    retryRequest?: BackgroundTaskRetryRequest;
    requestId?: string;
    completeOnImport?: boolean;
    expiresAt?: number;
    attempt?: number;
    importResult?: unknown;
}

export interface BackgroundTaskRetryRequest {
    path: string;
    body?: unknown;
    timeoutMs?: number;
}

export interface BackgroundTaskInput {
    userId: string;
    kind: BackgroundTaskKind;
    subject?: string | null;
    link?: string | null;
    total?: number;
    retryRequest?: BackgroundTaskRetryRequest;
    requestId?: string;
    completeOnImport?: boolean;
}

export interface BackgroundTaskHandle {
    id: string;
    setProgress: (done: number, total?: number, failed?: number) => void;
    succeed: () => void;
    fail: (error: unknown) => void;
}

/** Header used when the retry endpoint replays an already registered task. */
export const BACKGROUND_TASK_REPLAY_HEADER = 'x-background-task-replay';
export const BACKGROUND_TASK_REPLAY_ID_HEADER = 'x-background-task-replay-id';
const replayTokenStore = globalThis as typeof globalThis & { __backgroundTaskReplayToken?: string };
export const BACKGROUND_TASK_REPLAY_TOKEN = replayTokenStore.__backgroundTaskReplayToken ??= randomUUID();

export function isBackgroundTaskReplay(req: Request): boolean {
    return req.headers.get(BACKGROUND_TASK_REPLAY_HEADER) === BACKGROUND_TASK_REPLAY_TOKEN;
}

/** Replay the original operation against the claimed task without registering a duplicate task. */
export function trackBackgroundTaskForRequest<T>(
    req: Request,
    input: BackgroundTaskInput,
    operation: (task: BackgroundTaskHandle) => Promise<T>,
): Promise<T> {
    if (!isBackgroundTaskReplay(req)) return trackBackgroundTask(input, operation);
    const taskId = req.headers.get(BACKGROUND_TASK_REPLAY_ID_HEADER);
    const existing = taskId ? tasks.get(taskId) : undefined;
    if (existing?.userId === input.userId && existing.status === 'running') {
        return operation({
            id: existing.id,
            setProgress: (done, total, failed) => {
                existing.progress = { done, total: total ?? existing.progress?.total ?? done, failed: failed ?? existing.progress?.failed ?? 0 };
                scheduleSave();
            },
            succeed: () => undefined,
            fail: () => undefined,
        });
    }
    return operation({ id: `replay-${Date.now().toString(36)}`, setProgress: () => undefined, succeed: () => undefined, fail: () => undefined });
}

/** 已结束的事务保留时长 */
export const FINISHED_TASK_TTL_MS = 3 * 60 * 60 * 1000;
/** 每个用户最多保留的已结束事务数 */
const MAX_FINISHED_PER_USER = 30;

/** 服务重启时仍在进行的事务记录的错误码 */
export const SERVER_RESTARTED = 'SERVER_RESTARTED';
/** 进度频繁变化时合并写盘的间隔 */
const SAVE_DELAY_MS = 1000;

// 开发环境热更新会重新加载模块，挂在 globalThis 上保持同一份登记表
const store = globalThis as typeof globalThis & {
    __backgroundTasks?: Map<string, StoredTask>;
    __backgroundTasksLoaded?: boolean;
    __backgroundTasksFile?: string | null;
};
const tasks: Map<string, StoredTask> = store.__backgroundTasks ??= new Map();

let sequence = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 持久化文件路径；测试环境默认不写盘 */
function persistenceFile(): string | null {
    if (store.__backgroundTasksFile !== undefined) return store.__backgroundTasksFile;
    if (process.env.NODE_ENV === 'test') return null;
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'background-tasks.json');
}

function isStoredTask(value: unknown): value is StoredTask {
    if (typeof value !== 'object' || value === null) return false;
    const task = value as Partial<StoredTask>;
    return typeof task.id === 'string' && typeof task.userId === 'string' && typeof task.kind === 'string'
        && typeof task.status === 'string' && typeof task.startedAt === 'string';
}

/** 首次访问时读取上次保存的登记表，把当时进行中的事务标记为因重启中断 */
function ensureLoaded() {
    if (store.__backgroundTasksLoaded) return;
    store.__backgroundTasksLoaded = true;
    const file = persistenceFile();
    if (!file) return;
    let saved: unknown;
    try {
        saved = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ error }, 'Failed to read saved background tasks');
        return;
    }
    if (!Array.isArray(saved)) return;
    const now = new Date().toISOString();
    let interrupted = 0;
    for (const task of saved.filter(isStoredTask)) {
        if (tasks.has(task.id)) continue;
        if (task.status === 'running') {
            task.status = 'failed';
            task.error = SERVER_RESTARTED;
            task.finishedAt = now;
            interrupted++;
        }
        tasks.set(task.id, task);
    }
    if (interrupted > 0) {
        logger.info({ interrupted }, 'Marked background tasks interrupted by restart as failed');
        scheduleSave();
    }
}

function saveNow() {
    saveTimer = null;
    const file = persistenceFile();
    if (!file) return;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // 先写临时文件再改名，避免写到一半时进程退出留下损坏的文件
        const temp = `${file}.${process.pid}.tmp`;
        // Retry inputs can contain the original image or long prompts; keep them in memory only.
        fs.writeFileSync(temp, JSON.stringify([...tasks.values()].map(({ retryRequest: _retryRequest, importResult: _importResult, ...saved }) => saved)));
        fs.renameSync(temp, file);
    } catch (error) {
        logger.warn({ error }, 'Failed to save background tasks');
    }
}

function scheduleSave() {
    if (saveTimer || !persistenceFile()) return;
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
    // 不因待写盘的定时器阻止进程退出
    saveTimer.unref?.();
}

function prune(now: number) {
    ensureLoaded();
    let removed = false;
    for (const [id, task] of tasks) {
        if (task.status === 'running' && task.expiresAt && now >= task.expiresAt) {
            task.status = 'failed';
            task.error = task.canResume ? 'IMPORT_NOT_SAVED' : 'AI_TIMEOUT_ERROR';
            task.canResume = false;
            task.finishedAt = new Date(now).toISOString();
            removed = true;
        }
        if (task.finishedAt && now - Date.parse(task.finishedAt) > FINISHED_TASK_TTL_MS) {
            tasks.delete(id);
            removed = true;
        }
    }
    if (removed) scheduleSave();
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    // AI 错误码形如 AI_RESPONSE_ERROR: 详情，只保留错误码交给前端翻译
    return (message.startsWith('AI_') ? message.split(':')[0] : message).slice(0, 200);
}

/** 登记一个后台事务 */
export function startBackgroundTask(input: BackgroundTaskInput): BackgroundTaskHandle {
    const now = Date.now();
    prune(now);
    const id = `${now.toString(36)}-${(sequence++).toString(36)}`;
    const task: StoredTask = {
        id,
        userId: input.userId,
        kind: input.kind,
        subject: input.subject ?? null,
        status: 'running',
        progress: input.total !== undefined ? { done: 0, total: input.total, failed: 0 } : null,
        error: null,
        canRetry: !!input.retryRequest,
        link: input.link ?? null,
        retryRequest: input.retryRequest,
        requestId: input.requestId,
        completeOnImport: input.completeOnImport,
        expiresAt: input.completeOnImport ? now + DEFAULT_AI_TIMEOUT_MS : undefined,
        attempt: 0,
        startedAt: new Date(now).toISOString(),
        finishedAt: null,
    };
    tasks.set(id, task);
    scheduleSave();

    const attempt = task.attempt;
    const finish = (status: BackgroundTaskStatus, error: string | null) => {
        if (task.status !== 'running' || task.attempt !== attempt) return;
        task.status = status;
        task.error = error;
        task.finishedAt = new Date().toISOString();
        if (status !== 'failed') {
            task.canRetry = false;
            delete task.retryRequest;
            delete task.importResult;
        }
        task.canResume = false;
        scheduleSave();
    };
    return {
        id,
        setProgress: (done, total, failed) => {
            task.progress = { done, total: total ?? task.progress?.total ?? done, failed: failed ?? task.progress?.failed ?? 0 };
            scheduleSave();
        },
        succeed: () => finish('succeeded', null),
        fail: (error) => {
            finish('failed', errorMessage(error));
            logger.debug({ taskId: id, kind: task.kind, error: task.error }, 'Background task failed');
        },
    };
}

/**
 * 登记事务并执行 operation：正常返回标记成功，抛错标记失败后继续抛出
 */
export async function trackBackgroundTask<T>(input: BackgroundTaskInput, operation: (task: BackgroundTaskHandle) => Promise<T>): Promise<T> {
    const task = startBackgroundTask(input);
    const attempt = tasks.get(task.id)?.attempt;
    try {
        const result = await operation(task);
        const stored = tasks.get(task.id);
        if (stored?.attempt !== attempt) throw new Error('AI_TIMEOUT_ERROR');
        if (stored?.completeOnImport) {
            if (stored.status === 'failed') throw new Error(stored.error || 'IMPORT_NOT_SAVED');
        } else if (result instanceof Response && !result.ok) {
            const body = await result.clone().json().catch(() => null);
            task.fail(body?.message || 'AI_RESPONSE_ERROR');
        } else {
            task.succeed();
        }
        return result;
    } catch (error) {
        task.fail(error);
        throw error;
    }
}

/**
 * 当前用户的事务：进行中的在前（按开始时间），其后是最近结束的
 */
export function listBackgroundTasks(userId: string): BackgroundTask[] {
    prune(Date.now());
    const own = [...tasks.values()].filter((task) => task.userId === userId);
    const running = own.filter((task) => task.status === 'running')
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const finished = own.filter((task) => task.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
        .slice(0, MAX_FINISHED_PER_USER);
    return [...running, ...finished].map((task) => ({
        id: task.id,
        kind: task.kind,
        subject: task.subject,
        status: task.status,
        progress: task.progress && { ...task.progress },
        error: task.error,
        canRetry: task.status === 'failed' && !!task.retryRequest,
        ...(task.canResume && task.importResult ? { canResume: true } : {}),
        link: task.link,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
    }));
}

/** Only the owning user can inspect and replay a failed task's request. */
export function getBackgroundTaskRetry(userId: string, taskId: string): BackgroundTaskRetryRequest | null {
    prune(Date.now());
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status !== 'failed' || !task.retryRequest) return null;
    return task.retryRequest;
}

/** Atomically claim a failed task so two tabs cannot launch the same retry at once. */
export function beginBackgroundTaskRetry(userId: string, taskId: string, requestId?: string): BackgroundTaskRetryRequest | null {
    const retryRequest = getBackgroundTaskRetry(userId, taskId);
    if (!retryRequest) return null;
    const task = tasks.get(taskId)!;
    task.status = 'running';
    task.error = null;
    task.finishedAt = null;
    task.startedAt = new Date().toISOString();
    task.attempt = (task.attempt ?? 0) + 1;
    task.requestId = requestId;
    task.canResume = false;
    delete task.importResult;
    if (task.completeOnImport) task.expiresAt = Date.now() + DEFAULT_AI_TIMEOUT_MS;
    if (task.progress) task.progress = { ...task.progress, done: 0, failed: 0 };
    scheduleSave();
    return retryRequest;
}

/** Finish a claimed retry, retaining failures for another attempt. */
export function finishBackgroundTaskRetry(userId: string, taskId: string, error?: unknown): boolean {
    ensureLoaded();
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status !== 'running' || !task.retryRequest) return false;
    task.status = 'failed';
    task.error = errorMessage(error ?? 'RETRY_FAILED');
    task.finishedAt = new Date().toISOString();
    scheduleSave();
    return true;
}

/** Remove the original task after its retry has completed successfully. */
export function completeBackgroundTaskRetry(userId: string, taskId: string): boolean {
    ensureLoaded();
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status !== 'running' || !task.retryRequest) return false;
    tasks.delete(taskId);
    scheduleSave();
    return true;
}

/** 识别完成并不等于导入完成，保留结果供用户从后台继续校对。 */
export function awaitBackgroundTaskImport(userId: string, taskId: string, result: unknown, review: boolean): void {
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status !== 'running' || !task.completeOnImport) return;
    task.importResult = result;
    task.canResume = review;
    task.expiresAt = Date.now() + (review ? FINISHED_TASK_TTL_MS : DEFAULT_AI_TIMEOUT_MS);
    scheduleSave();
}

/** 只由原保存接口确认入库；失败时保留原请求，成功时移除图片重试载荷。 */
export function finishBackgroundTaskImport(userId: string, taskId: string, error?: string, itemId?: string): boolean {
    ensureLoaded();
    const task = tasks.get(taskId);
    // A late provider callback must not turn a timed-out or already-failed
    // attempt back into success. Retries claim the task by setting it running.
    if (!task || task.userId !== userId || !task.completeOnImport || task.status !== 'running') return false;
    task.status = error ? 'failed' : 'succeeded';
    task.error = error || null;
    task.canResume = false;
    task.finishedAt = new Date().toISOString();
    if (!error) {
        if (itemId) task.link = `/error-items/${encodeURIComponent(itemId)}`;
        task.canRetry = false;
        delete task.retryRequest;
        delete task.importResult;
    }
    scheduleSave();
    return true;
}

export function failBackgroundTaskImportRequest(userId: string, input: { taskId?: string; requestId?: string }, error: string): boolean {
    ensureLoaded();
    const task = [...tasks.values()].find(task => task.userId === userId && task.completeOnImport
        && (input.taskId ? task.id === input.taskId : !!input.requestId && task.requestId === input.requestId));
    return task ? finishBackgroundTaskImport(userId, task.id, error) : false;
}

export function getBackgroundTaskImportResult(userId: string, taskId: string) {
    prune(Date.now());
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status !== 'running' || !task.canResume || !task.importResult) return null;
    const input = task.retryRequest?.body as { imageBase64?: string; images?: string[]; subjectId?: string; returnPath?: string } | undefined;
    return {
        parsedData: task.importResult,
        imageBase64: input?.imageBase64 || input?.images?.[0] || '',
        ...(input?.images ? { images: input.images } : {}),
        subjectId: input?.subjectId || null,
        confirmBeforeImport: true,
        returnPath: input?.returnPath || '/',
    };
}

/** Remove one finished task after its replay succeeds. */
export function removeBackgroundTask(userId: string, taskId: string): boolean {
    ensureLoaded();
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId || task.status === 'running') return false;
    tasks.delete(taskId);
    scheduleSave();
    return true;
}

/** 清除当前用户已结束的事务记录 */
export function clearFinishedBackgroundTasks(userId: string): void {
    ensureLoaded();
    for (const [id, task] of tasks) {
        if (task.userId === userId && task.status !== 'running') tasks.delete(id);
    }
    scheduleSave();
}

/** 题目的简短说明：编号 + 题干开头（去掉公式符号和换行） */
export function describeQuestion(item: { shortId?: string | null; questionText?: string | null }): string {
    const text = (item.questionText ?? '')
        .replace(/\$+/g, '')
        .replace(/\\[a-zA-Z]+|[{}\\]/g, ' ')
        .replace(/[#*>`|_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*([，。；：？！、])\s*/g, '$1')
        .trim();
    const excerpt = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return [item.shortId, excerpt].filter(Boolean).join(' ') || '—';
}

/** 仅供测试：清空登记表；可指定持久化文件，模拟服务重启后重新读取 */
export function resetBackgroundTasksForTest(options: { file?: string | null } = {}): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    tasks.clear();
    store.__backgroundTasksFile = options.file === undefined ? null : options.file;
    store.__backgroundTasksLoaded = false;
}

/** 仅供测试：立即写盘 */
export function flushBackgroundTasksForTest(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveNow();
}

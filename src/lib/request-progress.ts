/** 长耗时请求的服务端阶段；前端只接收阶段状态，不接收 AI 原始流。 */
export const REQUEST_PROGRESS_STAGES = [
    'requesting',
    'thinking',
    'waiting',
    'collecting',
    'completed',
] as const;

export type RequestProgressStage = typeof REQUEST_PROGRESS_STAGES[number];

export interface RequestProgress {
    stage: RequestProgressStage;
    /** 面向用户的阶段估算值，不代表模型真实 token 百分比。 */
    percent: number;
}

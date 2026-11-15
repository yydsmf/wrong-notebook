import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIService } from '@/lib/ai/types';

const mocks = vi.hoisted(() => ({ openai: vi.fn(), azure: vi.fn(), gemini: vi.fn(), anthropic: vi.fn() }));
vi.mock('openai', () => ({
    default: class { chat = { completions: { create: mocks.openai } }; },
    AzureOpenAI: class { chat = { completions: { create: mocks.azure } }; },
}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mocks.gemini }; } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.anthropic }; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn() }) }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ prompts: {} }) }));
vi.mock('@/lib/ai/tag-service', () => ({ prefetchSubjectTags: vi.fn(async () => ({})) }));

import { OpenAIProvider } from '@/lib/ai/openai-provider';
import { AzureOpenAIProvider } from '@/lib/ai/azure-provider';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { AnthropicProvider } from '@/lib/ai/anthropic-provider';

const text = '<subject>语文</subject><question_text>跨页文章与问题</question_text><answer_text>答案</answer_text><analysis>解析</analysis><knowledge_points></knowledge_points><requires_image>false</requires_image>';
beforeEach(() => {
    vi.clearAllMocks();
    const completion = { choices: [{ message: { content: text }, finish_reason: 'stop' }] };
    mocks.openai.mockResolvedValue(completion);
    mocks.azure.mockResolvedValue(completion);
    mocks.gemini.mockResolvedValue({ text });
    mocks.anthropic.mockResolvedValue({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
});

const channels = [
    ['OpenAI', () => new OpenAIProvider({ apiKey: 'test-only', model: 'test-model' }), mocks.openai],
    ['Azure', () => new AzureOpenAIProvider({ apiKey: 'test-only', endpoint: 'https://example.com', deploymentName: 'test-model' }), mocks.azure],
    ['Gemini', () => new GeminiProvider({ apiKey: 'test-only' }), mocks.gemini],
    ['Anthropic', () => new AnthropicProvider({ apiKey: 'test-only' }), mocks.anthropic],
] as const;

describe.each(channels)('%s 单题多图请求', (name, createProvider, mock) => {
    it.each(['analyze', 'reanswer'] as const)('%s 在一次请求中携带所有图片，格式和顺序不变', async operation => {
        const provider: AIService = createProvider();
        const additional = [{ base64: 'Qg==', mimeType: 'image/jpeg' }];
        if (operation === 'analyze') {
            await provider.analyzeImage('QQ==', 'image/png', 'zh', undefined, '语文', undefined, undefined, additional);
        } else {
            await provider.reanswerQuestion('跨页文章与问题', 'zh', '语文', 'data:image/png;base64,QQ==', undefined, undefined, additional);
        }
        expect(mock).toHaveBeenCalledTimes(1);
        const request = mock.mock.calls[0][0];
        if (name === 'Gemini') {
            expect(request.contents.filter((part: { inlineData?: unknown }) => part.inlineData)).toEqual([
                { inlineData: { data: 'QQ==', mimeType: 'image/png' } },
                { inlineData: { data: 'Qg==', mimeType: 'image/jpeg' } },
            ]);
        } else if (name === 'Anthropic') {
            expect(request.messages[0].content.filter((part: { type: string }) => part.type === 'image')).toEqual([
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' } },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'Qg==' } },
            ]);
        } else {
            expect(request.messages[1].content.filter((part: { type: string }) => part.type === 'image_url')).toEqual([
                { type: 'image_url', image_url: { url: 'data:image/png;base64,QQ==' } },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Qg==' } },
            ]);
        }
        if (operation === 'analyze') {
            const system = name === 'Gemini' ? request.config.systemInstruction : name === 'Anthropic' ? request.system : request.messages[0].content;
            expect(system).toContain('属于同一道完整题目');
        }
    });
});

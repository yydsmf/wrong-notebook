import { NextResponse } from "next/server";
import { getAIService } from "@/lib/ai";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getQuestionGradeContext, resolveQuestionGrade } from "@/lib/question-grade";
import type { QuestionGradeProfile } from "@/lib/question-grade";
import { prisma } from "@/lib/prisma";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import type { CandidateTags, GradeLevel } from "@/lib/ai/types";
import { getNotebookCandidateTags } from "@/lib/ai/tag-service";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import { createLogger } from "@/lib/logger";
import { awaitBackgroundTaskImport, BACKGROUND_TASK_REPLAY_ID_HEADER, isBackgroundTaskReplay, trackBackgroundTask } from "@/lib/background-tasks";
import type { BackgroundTaskHandle } from '@/lib/background-tasks';
import { getAppTimeZone } from "@/lib/config";
import { getErrorMessage } from "@/lib/error-message";
import { consumeAiQuota } from "@/lib/ai-quota";
import { parseRequestId, REQUEST_ID_HEADER, updateStoredResponseProgressFromRequest, withRecoverableResponse } from "@/lib/recoverable-response";
import { POST as saveErrorItem } from '@/app/api/error-items/route';
import { buildQuestionImportPayload } from '@/lib/question-import-payload';
import { DEFAULT_AI_TIMEOUT_MS } from '@/lib/ai-timeout';
import type { RequestProgress } from "@/lib/request-progress";
import { parseImageInput, questionImagesSchema } from '@/lib/ai/image-input';
import type { AIImageInput } from '@/lib/ai/image-input';

const logger = createLogger('api:analyze');

async function handlePost(req: Request) {
    logger.info('Analyze API called');

    const updateProgress = (progress: RequestProgress) => updateStoredResponseProgressFromRequest(req, progress);
    updateProgress({ stage: 'requesting', percent: 15 });

    const session = await getServerSession(authOptions);

    // 认证检查
    if (!session) {
        logger.warn('Unauthorized access attempt');
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { language, subjectId } = body;
        if (body.images === undefined && !body.imageBase64) return badRequest('Missing image data');
        const imageList = questionImagesSchema.safeParse(body.images ?? [body.imageBase64]);
        if (!imageList.success) return badRequest('Invalid or missing image data');
        let images: AIImageInput[];
        try {
            images = imageList.data.map(image => parseImageInput(image, body.mimeType));
        } catch {
            return badRequest('Invalid image data URL');
        }
        const [{ base64: imageBase64, mimeType }] = images;

        logger.debug({
            imageLength: imageBase64?.length,
            mimeType,
            language,
            subjectId
        }, 'Request received');

        if (!imageBase64) {
            logger.warn('Missing image data');
            return badRequest("Missing image data");
        }

        // 先获取用户年级信息，用于动态生成 AI prompt 中的标签列表
        let userGrade: GradeLevel | null = null;
        let userGradeSemester: string | null = null;
        let subjectChinese: string | null = null;
        let candidateTags: CandidateTags | undefined;
        let notebookName: string | null = null;
        let gradeProfile: QuestionGradeProfile | null = null;

        if (session?.user?.email) {
            try {
                // 获取用户信息
                const user = await prisma.user.findUnique({
                    where: { email: session.user.email },
                    select: { id: true, educationStage: true, enrollmentYear: true, gradeRecognitionMode: true, fixedGradeSemester: true }
                });

                if (user) {
                    gradeProfile = user;
                    const context = getQuestionGradeContext(user, getAppTimeZone());
                    userGrade = context.grade;
                    userGradeSemester = context.gradeSemester;
                    logger.debug({ userGrade, userGradeSemester }, 'Calculated user grade');
                }

                // 错题本的学段 + 学科决定候选知识点：直接取该范围内的全部标签
                if (subjectId && user) {
                    const notebook = await prisma.subject.findUnique({
                        where: { id: subjectId },
                        select: { name: true, userId: true, stage: true, subjectKey: true, tagSet: true }
                    });

                    if (notebook && notebook.userId === user.id) {
                        notebookName = notebook.name;
                        const scope = resolveNotebookScope(notebook);
                        subjectChinese = scope.subject ? SUBJECT_DISPLAY_NAMES[scope.subject] : null;
                        candidateTags = await getNotebookCandidateTags(scope, notebook.tagSet || 'default');
                        logger.debug({ scope, tagSet: notebook.tagSet, candidateTagCount: candidateTags?.tags.length }, 'Notebook scope resolved');
                    }
                }
            } catch (error) {
                logger.error({ error }, 'Error fetching user/subject info');
                // 继续执行，不传递年级参数（会返回所有年级的标签）
            }
        }


        logger.info({ userGrade, userGradeSemester, subject: subjectChinese }, 'Calling AI service for image analysis');
        const limited = await consumeAiQuota(session.user, 'analyze');
        if (limited) return limited;

        updateProgress({ stage: 'thinking', percent: 25 });
        const defaultReturnPath = subjectId ? `/notebooks/${encodeURIComponent(subjectId)}/add` : '/';
        const returnPath = typeof body.returnPath === 'string' && body.returnPath.startsWith('/') && !body.returnPath.startsWith('//') && !body.returnPath.includes('\\')
            && new URL(body.returnPath, 'http://localhost').origin === 'http://localhost'
            ? body.returnPath
            : defaultReturnPath;
        const retryReplay = isBackgroundTaskReplay(req);
        const analyze = async (task?: BackgroundTaskHandle) => {
            const aiService = getAIService({ onProgress: updateProgress });
            const result = await aiService.analyzeImage(imageBase64, mimeType, language, userGrade, subjectChinese, userGradeSemester, candidateTags, ...(images.length > 1 ? [images.slice(1)] : []));
            if (!result.questionText?.trim() || !result.answerText?.trim() || !result.analysis?.trim()) {
                throw new Error('AI_RESPONSE_ERROR');
            }
            const importTaskId = task?.id || req.headers.get(BACKGROUND_TASK_REPLAY_ID_HEADER) || undefined;
            const parsed = {
                ...result,
                ...(gradeProfile ? { gradeSemester: resolveQuestionGrade(gradeProfile, { recognizedGradeSemester: result.gradeSemester }, getAppTimeZone()) } : {}),
                ...(importTaskId ? { importTaskId } : {}),
            };
            if (importTaskId) awaitBackgroundTaskImport(session.user.id, importTaskId, parsed, body.confirmBeforeImport === true);
            if (body.autoSave === true && body.confirmBeforeImport !== true) {
                updateProgress({ stage: 'saving', percent: 95 });
                const saved = await saveErrorItem(new Request(new URL('/api/error-items', req.url), {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') || '' },
                    body: JSON.stringify(buildQuestionImportPayload(parsed, { subjectId, imageUrls: imageList.data })),
                }));
                const savedBody = await saved.json();
                if (!saved.ok || !savedBody?.id) throw new Error(savedBody?.message || 'QUESTION_SAVE_FAILED');
                return { ...parsed, importedQuestion: {
                    id: savedBody.id, shortId: savedBody.shortId ?? null, subjectId: savedBody.subjectId ?? null,
                    notebookName: savedBody.subject?.name ?? null, ...(savedBody.duplicate ? { duplicate: true } : {}),
                } };
            }
            return parsed;
        };
        const analysisResult = retryReplay ? await analyze() : await trackBackgroundTask(
            {
                userId: session.user.id,
                kind: 'analyze',
                subject: notebookName,
                link: returnPath,
                requestId: parseRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? undefined,
                completeOnImport: true,
                retryRequest: {
                    path: '/api/analyze',
                    body: { ...(images.length > 1 ? { images: imageList.data } : { imageBase64, mimeType }), language, subjectId: subjectId || undefined, autoSave: body.autoSave === true, confirmBeforeImport: body.confirmBeforeImport === true, returnPath },
                    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
                },
            },
            analyze
        );
        updateProgress({ stage: 'collecting', percent: 86 });

        logger.debug({
            knowledgePointsCount: analysisResult.knowledgePoints?.length,
            knowledgePointsType: typeof analysisResult.knowledgePoints,
            isArray: Array.isArray(analysisResult.knowledgePoints)
        }, 'AI returned knowledge points');

        // AI 现在从数据库获取标签列表，返回的标签已经是标准化的，不需要额外处理
        if (!analysisResult.knowledgePoints || analysisResult.knowledgePoints.length === 0) {
            logger.warn('Knowledge points is empty or null');
        }

        logger.info('AI analysis successful');
        // AI 分析已经完成，但浏览器还需要整理并保存结果；最终完成状态由前端导入流程确认。
        updateProgress({ stage: 'collecting', percent: 90 });

        return NextResponse.json(analysisResult);
    } catch (error) {
        const message = getErrorMessage(error);
        logger.error({
            error: message,
            stack: error instanceof Error ? error.stack : undefined
        }, 'Analysis error occurred');

        // 返回具体的错误类型，便于前端显示详细提示
        let errorMessage = message || "Failed to analyze image";

        // 识别特定错误类型
        if (message && (
            message === 'AI_CONNECTION_FAILED' ||
            message === 'AI_RESPONSE_ERROR' ||
            message.includes('AI_AUTH_ERROR') ||
            message === 'AI_TIMEOUT_ERROR' ||
            message === 'AI_QUOTA_EXCEEDED' ||
            message === 'AI_PERMISSION_DENIED' ||
            message === 'AI_NOT_FOUND' ||
            message === 'AI_SERVICE_UNAVAILABLE' ||
            message === 'AI_UNKNOWN_ERROR' ||
            message === 'AI_OUTPUT_TRUNCATED'
        )) {
            // 直接传递 AI Provider 定义的错误类型 (如果是 AI_AUTH_ERROR，提取出来)
            if (message.includes('AI_AUTH_ERROR')) {
                errorMessage = 'AI_AUTH_ERROR';
            } else {
                errorMessage = message;
            }
        } else if (message.includes('Zod') || message.includes('validate')) {
            // Zod 验证错误
            errorMessage = 'AI_RESPONSE_ERROR';
        }

        return createErrorResponse(errorMessage, 500, ErrorCode.AI_ERROR, message);
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);

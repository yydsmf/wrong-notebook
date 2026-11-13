import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, internalError, notFound } from "@/lib/api-errors";
import { BACKGROUND_TASK_REPLAY_HEADER, BACKGROUND_TASK_REPLAY_ID_HEADER, BACKGROUND_TASK_REPLAY_TOKEN, beginBackgroundTaskRetry, completeBackgroundTaskRetry, finishBackgroundTaskRetry } from "@/lib/background-tasks";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const RETRY_TIMEOUT_MS = 10 * 60 * 1000;

/** Replay a failed task through the original API route, preserving its existing behavior. */
async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");

    const { id } = await params;
    const retry = beginBackgroundTaskRetry(user.id, id);
    if (!retry) return notFound("Retryable task not found");
    if (!retry.path.startsWith('/api/') || retry.path.startsWith('//')) {
        finishBackgroundTaskRetry(user.id, id, 'RETRY_FAILED');
        return notFound("Retryable task not found");
    }

    try {
        const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
        const target = new URL(retry.path, origin);
        const cookie = req.headers.get('cookie');
        const response = await fetch(target, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                [BACKGROUND_TASK_REPLAY_HEADER]: BACKGROUND_TASK_REPLAY_TOKEN,
                [BACKGROUND_TASK_REPLAY_ID_HEADER]: id,
                ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(retry.body ?? {}),
            signal: AbortSignal.timeout(Math.max(RETRY_TIMEOUT_MS, retry.timeoutMs ?? 0)),
            redirect: 'manual',
        });

        const responseText = await response.text();
        let body: unknown = responseText;
        try {
            body = responseText ? JSON.parse(responseText) : null;
        } catch {
            // Preserve non-JSON API responses.
        }
        if (retry.path === '/api/analyze' && response.ok && typeof body === 'object' && body !== null) {
            const input = retry.body as { imageBase64?: string; subjectId?: string | null; confirmBeforeImport?: boolean; returnPath?: string } | undefined;
            body = {
                retryImport: {
                    parsedData: body,
                    imageBase64: input?.imageBase64 || '',
                    subjectId: input?.subjectId || null,
                    confirmBeforeImport: input?.confirmBeforeImport === true,
                    returnPath: input?.returnPath || '/',
                },
            };
        }
        if (!response.ok) {
            finishBackgroundTaskRetry(user.id, id, typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : 'RETRY_FAILED');
        } else {
            completeBackgroundTaskRetry(user.id, id);
        }
        return NextResponse.json(body, {
            status: response.status,
        });
    } catch (error) {
        finishBackgroundTaskRetry(user.id, id, error);
        return internalError(error instanceof Error && error.name === 'TimeoutError' ? 'AI_TIMEOUT_ERROR' : 'RETRY_FAILED');
    }
}

export const POST = withRecoverableResponse(handlePost);

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { notFound, unauthorized } from '@/lib/api-errors';
import { getBackgroundTaskImportResult } from '@/lib/background-tasks';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized('Authentication required');
    const result = getBackgroundTaskImportResult(user.id, (await params).id);
    return result ? NextResponse.json({ retryImport: result }) : notFound('Import result not found');
}

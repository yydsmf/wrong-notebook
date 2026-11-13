"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GitCompareArrows, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DuplicateThresholdSetting } from '@/components/settings/duplicate-threshold-setting';
import { QuestionTextRenderer } from '@/components/question-text-renderer';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';
import { frontendLogger } from '@/lib/frontend-logger';
import type { QuestionSimilarityResponse } from '@/types/api';

interface QuestionSimilarityDialogProps {
    ids: string[];
}

/** 对比结果与阈值调整放在同一处，保存后重新读取服务端判重结果。 */
export function QuestionSimilarityDialog({ ids }: QuestionSimilarityDialogProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<QuestionSimilarityResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [firstId, secondId] = ids;
    const refresh = () => {
        setLoading(true);
        setData(null);
        setError(null);
        setRevision((value) => value + 1);
    };

    useEffect(() => {
        if (!open || !firstId || !secondId) return;
        let active = true;
        apiClient.post<QuestionSimilarityResponse>('/api/error-items/similarity', { ids: [firstId, secondId] })
            .then((result) => { if (active) setData(result); })
            .catch((failure: unknown) => {
                if (!active) return;
                const message = (failure as { data?: { message?: string } })?.data?.message;
                setError(message === 'Question text is required for similarity comparison' ? t.questionSimilarity.missingText : t.questionSimilarity.failed);
                frontendLogger.error('[Similarity]', '相似度比较失败', { error: failure instanceof Error ? failure.message : String(failure) });
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [open, firstId, secondId, revision, t.questionSimilarity.failed, t.questionSimilarity.missingText]);

    return (
        <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) refresh(); }}>
            <DialogTrigger asChild>
                <Button variant="outline" disabled={ids.length !== 2} title={t.questionSimilarity.selectTwo}>
                    <GitCompareArrows className="mr-2 h-4 w-4" />
                    {t.questionSimilarity.title}
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t.questionSimilarity.title}</DialogTitle>
                    <DialogDescription>{t.questionSimilarity.description}</DialogDescription>
                </DialogHeader>
                {loading && <div className="flex items-center gap-2 text-sm" role="status"><Loader2 className="h-4 w-4 animate-spin" />{t.common.loading}</div>}
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                {error && <Button variant="outline" onClick={refresh}>{t.questionSimilarity.retry}</Button>}
                {data && (
                    <>
                        <div className="space-y-2 rounded-lg bg-muted p-4" role="status">
                            <p className="text-sm">{t.questionSimilarity.score}</p>
                            <p className="text-3xl font-bold tabular-nums">{Number((data.similarity * 100).toFixed(4))}%</p>
                            <p className="text-sm">{t.questionSimilarity.threshold.replace('{threshold}', String(data.threshold))}</p>
                            <p className="text-sm font-medium">{data.duplicate ? t.questionSimilarity.duplicate : t.questionSimilarity.different}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {data.items.map((item, index) => (
                                <div key={item.id} className="min-w-0 space-y-2 rounded-lg border p-3">
                                    <Link href={`/error-items/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                                        {t.questionSimilarity.question.replace('{index}', String(index + 1))} · {item.shortId || '-'}
                                    </Link>
                                    {item.notebookName && <p className="text-xs text-muted-foreground">{item.notebookName}</p>}
                                    <div className="max-h-56 overflow-auto text-sm"><QuestionTextRenderer content={item.questionText} /></div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
                <DuplicateThresholdSetting onSaved={refresh} />
            </DialogContent>
        </Dialog>
    );
}

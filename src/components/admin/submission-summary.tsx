"use client";

import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import type { AdminSubmissionSummary } from "@/types/api";

export function SubmissionSummary({ submission }: { submission: AdminSubmissionSummary }) {
    const { t } = useLanguage();
    const text = t.admin.submissions;
    const { status, correctCount, gradedCount, totalCount } = submission;
    const rate = gradedCount > 0 ? `${Math.round(correctCount / gradedCount * 100)}%` : "-";

    return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Badge variant={status === "failed" ? "destructive" : status === "completed" ? "default" : "secondary"}>
            {status === "completed" ? t.studentAnswer.completed : status === "failed" ? text.partial : t.studentAnswer.grading}
        </Badge>
        <span>{text.correctCount.replace("{correct}", String(correctCount)).replace("{graded}", String(gradedCount))}</span>
        <span>{text.accuracy}：{rate}</span>
        <span className="text-muted-foreground">{text.gradedCount.replace("{graded}", String(gradedCount)).replace("{total}", String(totalCount))}</span>
    </div>;
}

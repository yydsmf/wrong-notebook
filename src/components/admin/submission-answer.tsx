"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuestionFigure } from "@/components/question-figure";
import { QuestionTextRenderer } from "@/components/question-text-renderer";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useLanguage } from "@/contexts/LanguageContext";
import { parseImageFragments } from "@/lib/image-fragments";
import type { StudentSubmissionAnswer } from "@/types/api";

interface SubmissionAnswerProps {
    answer: StudentSubmissionAnswer;
    number: number;
    onViewImage: (src: string) => void;
}

export function SubmissionAnswer({ answer, number, onViewImage }: SubmissionAnswerProps) {
    const { t } = useLanguage();
    const graded = answer.status === "graded" && answer.isCorrect !== null;
    const label = graded ? answer.isCorrect ? t.studentAnswer.correct : t.studentAnswer.incorrect
        : answer.status === "failed" ? t.studentAnswer.failed : t.studentAnswer.grading;
    const Icon = graded ? answer.isCorrect ? CheckCircle2 : XCircle : Clock;

    return <article className="min-w-0 space-y-4 border-t py-5 first:border-t-0">
        <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">{t.admin.submissions.questionNumber.replace("{number}", String(number))}</h4>
            <Badge variant={graded ? answer.isCorrect ? "default" : "destructive" : "secondary"} className="gap-1">
                <Icon className="size-3.5" />{label}
            </Badge>
        </div>
        <QuestionTextRenderer content={answer.questionText} className="text-sm" />
        <QuestionFigure svg={answer.figureSvg} images={parseImageFragments(answer.imageFragments)} />
        <div className="space-y-2 border-l-2 border-primary/30 pl-3 text-sm">
            <h5 className="font-medium">{t.admin.submissions.studentAnswer}</h5>
            {answer.userAnswer && <QuestionTextRenderer content={answer.userAnswer} />}
            {answer.userAnswerImageUrl && <button
                type="button"
                className="block max-w-full rounded-md border bg-white p-1 focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => onViewImage(answer.userAnswerImageUrl!)}
                aria-label={t.admin.submissions.viewAnswerImage}
                title={t.admin.submissions.viewAnswerImage}
            >
                <img src={answer.userAnswerImageUrl} alt={t.studentAnswer.answerImage} loading="lazy" className="max-h-72 max-w-full object-contain" />
            </button>}
            {!answer.userAnswer && !answer.userAnswerImageUrl && <p className="text-muted-foreground">{t.admin.submissions.noAnswer}</p>}
        </div>
        {answer.reason && <div className="space-y-1 text-sm">
            <h5 className="font-medium">{t.studentAnswer.reason}</h5>
            <MarkdownRenderer content={answer.reason} />
        </div>}
        {answer.mistakeAnalysis && <div className="space-y-1 text-sm">
            <h5 className="font-medium">{t.studentAnswer.mistake}</h5>
            <MarkdownRenderer content={answer.mistakeAnalysis} />
        </div>}
        <div className="space-y-2 bg-muted/40 p-3 text-sm">
            <h5 className="font-medium">{t.studentAnswer.referenceAnswer}</h5>
            <QuestionTextRenderer content={answer.answerText || t.admin.submissions.noReferenceAnswer} />
            {answer.analysis && <>
                <h5 className="font-medium">{t.studentAnswer.analysis}</h5>
                <MarkdownRenderer content={answer.analysis} />
            </>}
        </div>
    </article>;
}

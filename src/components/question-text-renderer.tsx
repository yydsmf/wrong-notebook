import katex from 'katex';
import { extractMathSegments } from '@/lib/markdown-math';
import 'katex/dist/katex.min.css';

interface QuestionTextRendererProps {
    content?: string | null;
    className?: string;
}

const MATH_PLACEHOLDER = /@@MATH(\d+)@@/g;

/** Render question transcription literally; only explicitly delimited math is interpreted. */
export function QuestionTextRenderer({ content, className = '' }: QuestionTextRendererProps) {
    const { masked, segments } = extractMathSegments(content);
    const parts = masked.split(MATH_PLACEHOLDER);

    return (
        <div className={`markdown-content min-w-0 overflow-x-auto whitespace-pre-wrap leading-relaxed ${className}`}>
            {parts.map((part, index) => {
                if (index % 2 === 0) return <span key={index}>{part}</span>;
                const segment = segments[Number(part)];
                if (!segment) return <span key={index}>{part}</span>;

                try {
                    return (
                        <span
                            key={index}
                            dangerouslySetInnerHTML={{
                                __html: katex.renderToString(segment.tex, {
                                    displayMode: segment.displayMode,
                                    throwOnError: true,
                                    strict: 'ignore',
                                }),
                            }}
                        />
                    );
                } catch {
                    return <span key={index}>{segment.source}</span>;
                }
            })}
        </div>
    );
}

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { parseDigest } from '@shared/digest';

interface DigestContentViewProps {
  content: string;
}

const DigestContentView: React.FC<DigestContentViewProps> = ({ content }) => {
  const blocks = useMemo(() => parseDigest(content), [content]);

  if (blocks) {
    return (
      <div className="space-y-8">
        {blocks.map((block) => (
          <section key={block.title} className="space-y-4">
            <h3 className="border-b pb-2 text-base font-semibold text-foreground">{block.title}</h3>
            {block.categories.map((cat) => (
              <div key={cat.name || 'uncategorized'} className="space-y-3">
                {cat.name && <h4 className="text-sm font-medium text-muted-foreground">{cat.name}</h4>}
                <div className="space-y-3">
                  {cat.items.map((item, idx) => (
                    <div key={idx} className="rounded-md border bg-card/60 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="font-bold text-foreground">{item.source}</span>
                        <span className="text-muted-foreground">评分：</span>
                        <span className="font-semibold text-success">{item.score}</span>
                      </div>
                      {item.summary && <p className="mt-1 leading-relaxed text-foreground">{item.summary}</p>}
                      {item.links.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {item.links.map((link) => (
                            <p key={link} className="break-all">
                              <span className="font-bold text-foreground">原文链接：</span>
                              <UniversalLink
                                to={link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                {link}
                              </UniversalLink>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {block.trends.length > 0 && (
              <ol className="space-y-2">
                {block.trends.map((trend, idx) => (
                  <li key={idx} className="flex gap-2 leading-relaxed">
                    <span className="font-bold text-foreground">{idx + 1}.</span>
                    <span className="text-foreground">{trend}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    );
  }

  if (content.includes('##') || content.includes('**')) {
    return (
      <article className="prose prose-sm max-w-none space-y-3 leading-relaxed text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</div>;
};

export default DigestContentView;

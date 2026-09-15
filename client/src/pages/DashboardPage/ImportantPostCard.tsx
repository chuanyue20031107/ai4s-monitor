import type { MouseEvent } from 'react';
import { ExternalLink, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CategoryBadge, MoatTagBadges, ScoreBadge } from '@/components/ai4s-badges';
import { formatShortDateTime } from '@/lib/format';
import type { IArticle } from '@/data/ai4s';

type ImportanceLevel = 'high' | 'mid' | 'normal';

export function importanceOf(score: number): ImportanceLevel {
  if (score === 5) return 'high';
  if (score >= 3) return 'mid';
  return 'normal';
}

const BAR_CLASS: Record<ImportanceLevel, string> = {
  high: 'bg-red-500',
  mid: 'bg-orange-400',
  normal: 'bg-blue-400',
};

const AVATAR_CLASS: Record<ImportanceLevel, string> = {
  high: 'bg-red-500/10 text-red-600',
  mid: 'bg-orange-400/10 text-orange-600',
  normal: 'bg-blue-400/10 text-blue-600',
};

const IMPORTANCE_LABEL: Record<ImportanceLevel, string> = {
  high: '高重要性',
  mid: '中重要性',
  normal: '普通情报',
};

interface ImportantPostCardProps {
  article: IArticle;
  onOpen: (id: string) => void;
}

export function ImportantPostCard({ article, onOpen }: ImportantPostCardProps) {
  const level = importanceOf(article.score);
  const openOriginal = (e: MouseEvent, url: string) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener');
  };

  return (
    <Card
      className="relative cursor-pointer overflow-hidden py-0 transition-shadow hover:shadow-md"
      onClick={() => onOpen(article.id)}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${BAR_CLASS[level]}`} />
      <CardContent className="space-y-2 py-4 pl-5 pr-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${AVATAR_CLASS[level]}`}
          >
            {(article.sourceName || '?').slice(0, 1)}
          </span>
          <span className="max-w-[240px] truncate text-sm font-medium text-foreground">
            {article.sourceName || '未知来源'}
          </span>
          <span>{formatShortDateTime(article.publishedAt)}</span>
          <span
            className={`font-medium ${level === 'high' ? 'text-red-600' : level === 'mid' ? 'text-orange-600' : 'text-blue-600'}`}
          >
            {IMPORTANCE_LABEL[level]}
          </span>
          <ScoreBadge score={article.score} />
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug text-foreground">{article.title}</h3>
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {article.summary || '暂无摘要，点击查看详情。'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={article.category} />
          <MoatTagBadges tags={article.moatTags.slice(0, 4)} />
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(article.id);
              }}
            >
              <Eye className="size-4" />
              查看详情
            </Button>
            <Button variant="ghost" size="sm" onClick={(e) => openOriginal(e, article.url)}>
              <ExternalLink className="size-4" />
              查看原文
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

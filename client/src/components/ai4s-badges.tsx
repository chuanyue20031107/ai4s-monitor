import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  CRAWL_STATUS_LABELS,
  type AnalysisStatus,
  type Category,
  type ContentType,
  type CrawlStatus,
  type MoatTag,
  type RunStatus,
} from '@/data/ai4s';

/** 重要性评分徽章（1-5，=5 重点高亮） */
export function ScoreBadge({ score }: { score: number }) {
  if (!score) return <Badge variant="outline">未评分</Badge>;
  return (
    <Badge className={score === 5 ? 'tabular-nums' : 'bg-primary/10 text-primary hover:bg-primary/10 tabular-nums'} variant={score === 5 ? 'default' : 'secondary'}>
      {score} 分
    </Badge>
  );
}

/** 分类徽章 */
export function CategoryBadge({ category }: { category: Category | '' }) {
  if (!category) return <span className="text-muted-foreground text-xs">—</span>;
  return <Badge variant="outline">{category}</Badge>;
}

/** 内容类型徽章（company_claim / paper_result / media_report） */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  company_claim: '公司主张',
  paper_result: '论文结果',
  media_report: '媒体报道',
};

export function ContentTypeBadge({ contentType }: { contentType: ContentType | '' }) {
  if (!contentType) return <span className="text-muted-foreground text-xs">—</span>;
  return <Badge variant="outline">{CONTENT_TYPE_LABELS[contentType] ?? contentType}</Badge>;
}

/** 护城河影响标签组 */
export function MoatTagBadges({ tags }: { tags: MoatTag[] }) {
  if (!tags.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

/** 文章分析状态徽章 */
export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  if (status === 'analyzing') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        分析中
      </Badge>
    );
  }
  if (status === 'done') return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">已完成</Badge>;
  if (status === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" />
        失败
      </Badge>
    );
  }
  return <Badge variant="outline">待分析</Badge>;
}

/** 任务运行状态徽章 */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  if (status === 'running') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        运行中
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" />
        失败
      </Badge>
    );
  }
  return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">成功</Badge>;
}

/** 来源抓取状态徽章（覆盖全部 10 种状态） */
const CRAWL_WARNING_STATUSES: readonly CrawlStatus[] = [
  'needs_config',
  'timeout',
  'parse_failed',
  'robots_blocked',
];
const CRAWL_ERROR_STATUSES: readonly CrawlStatus[] = [
  'invalid_url',
  'network_error',
  'failed',
];

export function CrawlStatusBadge({ status }: { status: CrawlStatus }) {
  const label = CRAWL_STATUS_LABELS[status] ?? status;
  if (status === 'ok') {
    return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{label}</Badge>;
  }
  if (status === 'no_content') {
    return <Badge variant="secondary">{label}</Badge>;
  }
  if (CRAWL_WARNING_STATUSES.includes(status)) {
    return (
      <Badge className="gap-1 bg-amber-500/10 text-amber-600 hover:bg-amber-500/10">
        <AlertTriangle className="size-3" />
        {label}
      </Badge>
    );
  }
  if (CRAWL_ERROR_STATUSES.includes(status)) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" />
        {label}
      </Badge>
    );
  }
  return <Badge variant="outline">{label}</Badge>;
}

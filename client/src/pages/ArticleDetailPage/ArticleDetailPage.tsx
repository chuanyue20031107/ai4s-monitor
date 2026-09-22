import { Link, useParams } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  SearchX,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  AnalysisStatusBadge,
  CategoryBadge,
  ContentTypeBadge,
  CrawlStatusBadge,
  MoatTagBadges,
  ScoreBadge,
} from '@/components/ai4s-badges';
import { formatDateTime } from '@/lib/format';
import { SOURCE_SEED } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  );
}

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { articles, sourceRuntime } = useAi4s();
  const article = articles.find((a) => a.id === id);
  const source = article ? SOURCE_SEED.find((s) => s.id === article.sourceId) ?? null : null;
  const runtime = source ? sourceRuntime[source.id] : undefined;

  if (!article) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <SearchX className="size-10" />
        <p className="text-sm">情报不存在或已被清理</p>
        <Button variant="outline" asChild>
          <Link to="/articles">返回情报列表</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/articles">情报文章</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>文章详情</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左列：文章主体 */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardDescription>原文标题</CardDescription>
              <CardTitle className="text-lg leading-snug">{article.title}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <AnalysisStatusBadge status={article.analysisStatus} />
                <ScoreBadge score={article.score} />
                <CategoryBadge category={article.category} />
                <ContentTypeBadge contentType={article.contentType} />
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={article.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  查看原文
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/ai-control?articleId=${encodeURIComponent(article.id)}`}>
                  <Bot className="size-4" />
                  交给 Codex 分析
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">中文摘要</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{article.summary || '暂无摘要，请先完成 AI 分析。'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">重要性理由</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">
                {article.importanceReason || '暂无重要性理由，请先完成 AI 分析。'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">分析过程状态</CardTitle>
              <CardDescription>
                {article.failureReason ? `失败原因：${article.failureReason}` : '完整处理工作流：抓取 → 解析 → 去重 → 关联主体 → 分类 → AI 分析 → 保存'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {article.analysisSteps.map((step, index) => (
                  <div
                    key={step.step}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs"
                  >
                    {step.status === 'done' && <CheckCircle2 className="size-3.5 text-primary" />}
                    {step.status === 'running' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                    {step.status === 'failed' && <XCircle className="size-3.5 text-destructive" />}
                    {step.status === 'pending' && <Circle className="size-3.5 text-muted-foreground" />}
                    <span className={step.status === 'pending' ? 'text-muted-foreground' : ''}>
                      {index + 1}. {step.step}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右列：元信息 + 来源主体资料 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">情报元信息</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/60">
              <InfoRow label="来源主体">{article.sourceName}</InfoRow>
              <InfoRow label="主体类型">{article.sourceType || '—'}</InfoRow>
              <InfoRow label="分类"><CategoryBadge category={article.category} /></InfoRow>
              <InfoRow label="评分"><ScoreBadge score={article.score} /></InfoRow>
              <InfoRow label="内容类型"><ContentTypeBadge contentType={article.contentType} /></InfoRow>
              <InfoRow label="护城河标签"><MoatTagBadges tags={article.moatTags} /></InfoRow>
              <InfoRow label="发布时间">{formatDateTime(article.publishedAt)}</InfoRow>
              <InfoRow label="抓取时间">{formatDateTime(article.crawledAt)}</InfoRow>
            </CardContent>
          </Card>

          {source ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">来源主体资料</CardTitle>
                <CardDescription>{source.directions}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 divide-y divide-border/60">
                <InfoRow label="主体名称">{source.name}</InfoRow>
                <InfoRow label="主体类型">{source.type}</InfoRow>
                <InfoRow label="国家 / 地区">{source.region}</InfoRow>
                <InfoRow label="核心产品">{source.products || '—'}</InfoRow>
                <InfoRow label="代表人物">{source.representative || '—'}</InfoRow>
                <InfoRow label="优先级">
                  <Badge variant={source.priority === '高' ? 'default' : 'outline'}>{source.priority}</Badge>
                </InfoRow>
                <InfoRow label="抓取状态">
                  <div className="flex flex-col items-end gap-1">
                    <CrawlStatusBadge status={runtime?.crawlStatus ?? 'idle'} />
                    {runtime?.lastError && (
                      <span className="max-w-[200px] truncate text-xs text-destructive" title={runtime.lastError}>
                        {runtime.lastError}
                      </span>
                    )}
                  </div>
                </InfoRow>
                <InfoRow label="最近抓取">{formatDateTime(runtime?.lastCrawlAt ?? null)}</InfoRow>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {source.website && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={source.website} target="_blank" rel="noreferrer">官网</a>
                    </Button>
                  )}
                  {source.github && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={source.github} target="_blank" rel="noreferrer">GitHub</a>
                    </Button>
                  )}
                  {source.linkedin && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={source.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>
                    </Button>
                  )}
                  {source.feedUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={source.feedUrl} target="_blank" rel="noreferrer">RSS / 会议</a>
                    </Button>
                  )}
                </div>
                {source.wechat && (
                  <p className="pt-2 text-xs text-muted-foreground">官方公众号：{source.wechat}</p>
                )}
                {source.notes && (
                  <p className="pt-1 text-xs text-muted-foreground">备注：{source.notes}</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">来源主体资料</CardTitle>
              </CardHeader>
              <CardContent>
                <Separator className="mb-3" />
                <p className="text-sm text-muted-foreground">
                  该情报为手动提交，未关联清单内来源主体。
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

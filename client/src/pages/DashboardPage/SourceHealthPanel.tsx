/**
 * 看板 4：来源健康度（真实抓取状态四分类）+ 来源主体情报数排行 Top10
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SOURCE_SEED, type CrawlStatus, type IArticle } from '@/data/ai4s';
import type { ISourceRuntime } from '@/store/Ai4sStore';

const HEALTH_STATES = [
  { key: 'ok', label: '正常' },
  { key: 'no_content', label: '无新内容' },
  { key: 'failed', label: '抓取失败' },
  { key: 'idle', label: '未运行' },
] as const;

type HealthKey = (typeof HEALTH_STATES)[number]['key'];

function classifyHealth(status: CrawlStatus): HealthKey {
  if (status === 'ok') return 'ok';
  if (status === 'no_content') return 'no_content';
  if (status === 'idle') return 'idle';
  return 'failed';
}

const HEALTH_COLOR: Record<HealthKey, string> = {
  ok: 'bg-primary',
  no_content: 'bg-muted-foreground/40',
  failed: 'bg-destructive',
  idle: 'bg-muted-foreground/25',
};

export function SourceHealthPanel({
  sourceRuntime,
  articles,
}: {
  sourceRuntime: Record<string, ISourceRuntime>;
  articles: IArticle[];
}) {
  const navigate = useNavigate();

  const healthCounts = useMemo(() => {
    const counts: Record<HealthKey, number> = { ok: 0, no_content: 0, failed: 0, idle: 0 };
    for (const runtime of Object.values(sourceRuntime)) {
      if (!runtime.enabled) continue;
      counts[classifyHealth(runtime.crawlStatus)] += 1;
    }
    return counts;
  }, [sourceRuntime]);

  const topSources = useMemo(() => {
    const bySource = new Map<string, number>();
    for (const a of articles) {
      bySource.set(a.sourceId, (bySource.get(a.sourceId) ?? 0) + 1);
    }
    const rows = SOURCE_SEED.map((s) => ({ id: s.id, name: s.name, count: bySource.get(s.id) ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((x, y) => y.count - x.count)
      .slice(0, 10);
    return rows;
  }, [articles]);

  const totalChecked = Object.values(healthCounts).reduce((s, v) => s + v, 0);
  const maxCount = topSources.length > 0 ? topSources[0].count : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">来源健康度与情报来源排行</CardTitle>
        <CardDescription>
          上：启用来源最近一次抓取状态 · 下：当前筛选范围内文章数 Top10 主体（点击跳转文章列表）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {HEALTH_STATES.map((state) => (
            <div key={state.key} className="rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${HEALTH_COLOR[state.key]}`} />
                <span className="text-xs text-muted-foreground">{state.label}</span>
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {healthCounts[state.key]}
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {totalChecked > 0
            ? `共 ${totalChecked} 个启用来源有抓取状态记录`
            : '暂无来源抓取状态记录，请先到「监控来源」执行健康检查或抓取'}
        </div>
        {topSources.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            暂无情报来源排行数据
          </div>
        ) : (
          <ul className="space-y-1.5">
            {topSources.map((row, index) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => navigate(`/articles?source=${encodeURIComponent(row.id)}`)}
                >
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {row.count} 篇
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 来源健康检查面板 — 全量健康检查入口 + 统计结果展示
 */
import { HeartPulse, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CRAWL_STATUS_LABELS, SOURCE_SEED } from '@/data/ai4s';
import type { IAi4sHealthCheckStats } from '@shared/api.interface';

interface HealthCheckPanelProps {
  /** 最近一次健康检查统计（进行中 / 已结束均传入） */
  stats: IAi4sHealthCheckStats | null;
  /** 健康检查是否进行中 */
  running: boolean;
  /** 点击「全量健康检查」回调 */
  onStart: () => void;
}

function formatCheckTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('zh-CN', { hour12: false })
    : '—';
}

export function HealthCheckPanel({ stats, running, onStart }: HealthCheckPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HeartPulse className="size-4 text-primary" />
              来源健康检查
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              检查 {SOURCE_SEED.length} 条来源的地址有效性、RSS / Sitemap 自动发现与 robots
              限制，并为每个来源标记可用的抓取通道
            </p>
          </div>
          <Button onClick={onStart} disabled={running}>
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <HeartPulse className="size-4" />
            )}
            {running ? '检查进行中…' : '全量健康检查'}
          </Button>
        </div>
      </CardHeader>
      {(stats || running) && (
        <CardContent className="space-y-3">
          {running && (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
              <Loader2 className="size-3.5 animate-spin" />
              检查进行中，来源列表实时更新…
            </div>
          )}
          {stats && stats.total > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">总检查数</div>
                  <div className="text-lg font-semibold tabular-nums">{stats.total}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">正常</div>
                  <div className="text-lg font-semibold tabular-nums text-primary">
                    {stats.ok}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">无新内容</div>
                  <div className="text-lg font-semibold tabular-nums text-muted-foreground">
                    {stats.noContent}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">失败</div>
                  <div className="text-lg font-semibold tabular-nums text-destructive">
                    {stats.failed}
                  </div>
                </div>
              </div>
              {stats.failureByType.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">失败原因分布</span>
                  <div className="flex flex-wrap gap-2">
                    {stats.failureByType.map((item) => (
                      <span
                        key={item.type}
                        className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
                      >
                        {CRAWL_STATUS_LABELS[item.type]} · {item.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                最近检查时间：{formatCheckTime(stats.lastCheckAt)}
              </p>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

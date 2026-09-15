import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, FlaskConical, Loader2, Rss, SearchX } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrawlStatusBadge } from '@/components/ai4s-badges';
import { fetchHealthCheckStats, fetchRuns, startCrawlAll, startHealthCheck } from '@/api/ai4s';
import { HealthCheckPanel } from './HealthCheckPanel';
import type { IAi4sHealthCheckStats } from '@shared/api.interface';
import { formatDateTime } from '@/lib/format';
import { SOURCE_GROUPS, SOURCE_SEED, type ISource, type Priority } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';
import { UniversalLink } from '@lark-apaas/client-toolkit';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-sm">{children}</span>
    </div>
  );
}

/** 抓取策略中文标签 */
const CRAWL_STRATEGY_LABELS: Record<string, string> = {
  auto: '自动（RSS>Sitemap>会议列表>网页兜底）',
  rss: 'RSS / Atom',
  sitemap: 'Sitemap',
  entry: '会议 / 活动入口',
  crawler: '网页 crawler 兜底',
  disabled: '不可抓取 / 需人工配置',
};

/** 健康检查轮询间隔（毫秒） */
const HEALTH_CHECK_POLL_INTERVAL_MS = 5000;

export default function SourcesPage() {
  const { sourceRuntime, busy, toggleSource, crawlSource, testSource, refreshAfterWrite } =
    useAi4s();

  const [groupFilter, setGroupFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [directionInput, setDirectionInput] = useState('');
  const [detailSource, setDetailSource] = useState<ISource | null>(null);
  const [hcStats, setHcStats] = useState<IAi4sHealthCheckStats | null>(null);
  const [hcRunning, setHcRunning] = useState(false);
  const [crawlAllRunning, setCrawlAllRunning] = useState(false);
  const [crawlAllProgress, setCrawlAllProgress] = useState<{ processed: number; total: number }>({
    processed: 0,
    total: 0,
  });
  const crawlAllRef = useRef<{ runId: string; total: number } | null>(null);

  const regions = useMemo(() => Array.from(new Set(SOURCE_SEED.map((s) => s.region))), []);

  const filtered = useMemo(
    () =>
      SOURCE_SEED.filter((s) => {
        if (groupFilter !== 'all' && s.group !== groupFilter) return false;
        if (regionFilter !== 'all' && s.region !== regionFilter) return false;
        if (priorityFilter !== 'all' && s.priority !== priorityFilter) return false;
        if (directionInput.trim() && !s.directions.includes(directionInput.trim())) return false;
        return true;
      }),
    [groupFilter, regionFilter, priorityFilter, directionInput],
  );

  const detailRuntime = detailSource ? sourceRuntime[detailSource.id] : undefined;

  const handleCrawl = async (source: ISource) => {
    const ok = await crawlSource(source.id);
    if (ok) toast.success(`「${source.name}」抓取并分析完成`);
  };

  const pollHealthCheck = useCallback(async () => {
    try {
      const res = await fetchHealthCheckStats();
      setHcStats(res.stats);
      await refreshAfterWrite();
      if (!res.stats.running) {
        setHcRunning(false);
      }
    } catch (error) {
      logger.warn('健康检查状态轮询失败:', String(error));
    }
  }, [refreshAfterWrite]);

  const handleStartHealthCheck = async () => {
    try {
      const res = await startHealthCheck();
      toast.success(`已启动全量健康检查（${res.total} 个来源）`);
      setHcRunning(true);
      void pollHealthCheck();
    } catch (error) {
      logger.error('启动健康检查失败:', String(error));
      toast.error(`启动失败：${String(error).slice(0, 80)}`);
    }
  };

  const pollCrawlAll = useCallback(async () => {
    const ref = crawlAllRef.current;
    if (!ref) return;
    try {
      const res = await fetchRuns();
      const run = res.items.find((r) => r.id === ref.runId);
      if (run) {
        setCrawlAllProgress({ processed: run.processed, total: ref.total });
        if (run.status !== 'running') {
          setCrawlAllRunning(false);
          await refreshAfterWrite();
          toast.success(`全量抓取完成：${run.detail}`);
          return;
        }
      }
      await refreshAfterWrite();
    } catch (error) {
      logger.warn('全量抓取状态轮询失败:', String(error));
    }
  }, [refreshAfterWrite]);

  const handleStartCrawlAll = async () => {
    try {
      const res = await startCrawlAll();
      crawlAllRef.current = { runId: res.runId, total: res.total };
      setCrawlAllProgress({ processed: 0, total: res.total });
      setCrawlAllRunning(true);
      toast.success(`已启动全量抓取（${res.total} 个来源），完成后会自动刷新列表`);
      void pollCrawlAll();
    } catch (error) {
      logger.error('启动全量抓取失败:', String(error));
      toast.error(`启动失败：${String(error).slice(0, 80)}`);
    }
  };

  // 页面加载时同步一次健康检查状态；若后台仍在检查则恢复轮询
  useEffect(() => {
    let cancelled = false;
    void fetchHealthCheckStats()
      .then((res) => {
        if (cancelled) return;
        setHcStats(res.stats);
        if (res.stats.running) setHcRunning(true);
      })
      .catch((error: unknown) => {
        logger.warn('获取健康检查状态失败:', String(error));
      });
    void fetchRuns()
      .then((res) => {
        if (cancelled) return;
        const running = res.items.find((r) => r.taskType === '全量抓取' && r.status === 'running');
        if (running) {
          crawlAllRef.current = { runId: running.id, total: SOURCE_SEED.length };
          setCrawlAllProgress({ processed: running.processed, total: SOURCE_SEED.length });
          setCrawlAllRunning(true);
        }
      })
      .catch((error: unknown) => {
        logger.warn('获取运行记录失败:', String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 检查进行中每 5 秒轮询 stats 并刷新来源运行态；结束后停止轮询
  useEffect(() => {
    if (!hcRunning) return undefined;
    const timer = window.setInterval(() => {
      void pollHealthCheck();
    }, HEALTH_CHECK_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [hcRunning, pollHealthCheck]);

  // 全量抓取进行中每 5 秒轮询进度并刷新来源运行态；结束后停止轮询
  useEffect(() => {
    if (!crawlAllRunning) return undefined;
    const timer = window.setInterval(() => {
      void pollCrawlAll();
    }, HEALTH_CHECK_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [crawlAllRunning, pollCrawlAll]);

  return (
    <div className="space-y-4">
      {/* 来源健康检查 */}
      <HealthCheckPanel
        stats={hcStats}
        running={hcRunning}
        onStart={() => void handleStartHealthCheck()}
      />

      {/* 筛选 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">来源筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">清单分组</span>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分组</SelectItem>
                {SOURCE_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">国家 / 地区</span>
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部地区</SelectItem>
                {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">优先级</span>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="高">高</SelectItem>
                <SelectItem value="中">中</SelectItem>
                <SelectItem value="低">低</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">研究方向（包含）</span>
            <Input
              placeholder="如：药物 / 材料 / 模型"
              value={directionInput}
              onChange={(e) => setDirectionInput(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 来源清单 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">
              监控来源清单（{filtered.length}/{SOURCE_SEED.length}）
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={hcRunning}
                onClick={() => void handleStartHealthCheck()}
              >
                {hcRunning ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                {hcRunning ? '测试中…' : '全部测试'}
              </Button>
              <Button size="sm" disabled={crawlAllRunning} onClick={() => void handleStartCrawlAll()}>
                {crawlAllRunning ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {crawlAllRunning
                  ? `抓取中 ${crawlAllProgress.processed}/${crawlAllProgress.total}`
                  : '全部抓取'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[170px] whitespace-nowrap">主体名称</TableHead>
                  <TableHead className="whitespace-nowrap">主体类型</TableHead>
                  <TableHead className="whitespace-nowrap">国家 / 地区</TableHead>
                  <TableHead className="min-w-[150px] whitespace-nowrap">研究方向</TableHead>
                  <TableHead className="min-w-[130px] whitespace-nowrap">核心产品 / 平台</TableHead>
                  <TableHead className="whitespace-nowrap">代表人物</TableHead>
                  <TableHead className="whitespace-nowrap">优先级</TableHead>
                  <TableHead className="whitespace-nowrap">启用</TableHead>
                  <TableHead className="whitespace-nowrap">最近抓取</TableHead>
                  <TableHead className="whitespace-nowrap">抓取状态</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-36">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <SearchX className="size-8" />
                        <span className="text-sm">没有符合条件的来源</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                   filtered.map((source) => {
                     const runtime = sourceRuntime[source.id];
                     const crawling = busy[`source:${source.id}`];
                     const testing = busy[`test:${source.id}`];
                    return (
                      <TableRow key={source.id}>
                        <TableCell>
                          <button
                            type="button"
                            className="block max-w-[170px] truncate text-left font-medium hover:text-primary"
                            onClick={() => setDetailSource(source)}
                          >
                            {source.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="block max-w-[130px] truncate" title={`${source.group} · ${source.type}`}>{source.type}</span>
                        </TableCell>
                        <TableCell className="text-xs">{source.region}</TableCell>
                        <TableCell><span className="block max-w-[150px] truncate text-xs">{source.directions}</span></TableCell>
                        <TableCell><span className="block max-w-[130px] truncate text-xs">{source.products || '—'}</span></TableCell>
                        <TableCell><span className="block max-w-[110px] truncate text-xs">{source.representative || '—'}</span></TableCell>
                        <TableCell>
                          <Badge variant={source.priority === '高' ? 'default' : 'outline'}>{source.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={runtime?.enabled ?? true}
                            onCheckedChange={() => toggleSource(source.id)}
                            aria-label={`启用或停用 ${source.name}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-xs">
                          {formatDateTime(runtime?.lastCrawlAt ?? null)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                             <CrawlStatusBadge status={runtime?.crawlStatus ?? 'idle'} />
                             {(runtime?.lastDiagnostic || runtime?.lastError) && (
                               <span
                                 className="block max-w-[150px] truncate text-xs text-destructive"
                                 title={runtime.lastDiagnostic || runtime.lastError || ''}
                               >
                                 {runtime.lastDiagnostic || runtime.lastError}
                               </span>
                             )}
                          </div>
                        </TableCell>
                         <TableCell className="whitespace-nowrap text-right">
                           <div className="flex justify-end gap-2">
                             <Button
                               size="sm"
                               variant="outline"
                               disabled={testing}
                               onClick={() => void testSource(source.id)}
                             >
                               {testing ? (
                                 <Loader2 className="size-4 animate-spin" />
                               ) : (
                                 <FlaskConical className="size-4" />
                               )}
                               {testing ? '测试中' : '测试'}
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               disabled={crawling || runtime?.enabled === false}
                               onClick={() => handleCrawl(source)}
                             >
                               {crawling ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                               {crawling ? '抓取中' : '抓取'}
                             </Button>
                           </div>
                         </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 来源详情弹窗（清单全字段） */}
      <Dialog open={!!detailSource} onOpenChange={(open) => !open && setDetailSource(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {detailSource && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Rss className="size-4 text-primary" />
                  {detailSource.name}
                </DialogTitle>
                <DialogDescription>{detailSource.group} · {detailSource.type} · {detailSource.region}</DialogDescription>
              </DialogHeader>
              <div>
                <DetailRow label="AI4S 研究方向">{detailSource.directions}</DetailRow>
                <DetailRow label="核心产品 / 平台">{detailSource.products || '—'}</DetailRow>
                <DetailRow label="代表人物 / 负责人">{detailSource.representative || '—'}</DetailRow>
                <DetailRow label="优先级">
                  <Badge variant={detailSource.priority === '高' ? 'default' : 'outline'}>{detailSource.priority}</Badge>
                </DetailRow>
                <DetailRow label="官方网站">
                  {detailSource.website ? (
                    <UniversalLink className="text-primary hover:underline" to={detailSource.website} target="_blank" rel="noreferrer">
                      {detailSource.website}
                    </UniversalLink>
                  ) : '—'}
                </DetailRow>
                <DetailRow label="官方公众号">{detailSource.wechat || '—'}</DetailRow>
                <DetailRow label="LinkedIn">
                  {detailSource.linkedin ? (
                    <UniversalLink className="text-primary hover:underline" to={detailSource.linkedin} target="_blank" rel="noreferrer">
                      {detailSource.linkedin}
                    </UniversalLink>
                  ) : '—'}
                </DetailRow>
                <DetailRow label="GitHub">
                  {detailSource.github ? (
                    <UniversalLink className="text-primary hover:underline" to={detailSource.github} target="_blank" rel="noreferrer">
                      {detailSource.github}
                    </UniversalLink>
                  ) : '—'}
                </DetailRow>
                <DetailRow label="RSS / 会议链接">
                  {detailSource.feedUrl ? (
                    <UniversalLink className="text-primary hover:underline" to={detailSource.feedUrl} target="_blank" rel="noreferrer">
                      {detailSource.feedUrl}
                    </UniversalLink>
                  ) : '—'}
                </DetailRow>
                <DetailRow label="备注">{detailSource.notes || '—'}</DetailRow>
                 <DetailRow label="抓取状态">
                   <CrawlStatusBadge status={detailRuntime?.crawlStatus ?? 'idle'} />
                 </DetailRow>
                 <DetailRow label="抓取策略">
                   {detailRuntime
                     ? (CRAWL_STRATEGY_LABELS[detailRuntime.crawlStrategy] ??
                         detailRuntime.crawlStrategy) || '—'
                     : '—'}
                 </DetailRow>
                 <DetailRow label="发现的订阅地址">
                   {detailRuntime?.discoveredFeedUrl ? (
                     <UniversalLink
                       className="text-primary hover:underline"
                       to={detailRuntime.discoveredFeedUrl}
                       target="_blank"
                       rel="noreferrer"
                     >
                       {detailRuntime.discoveredFeedUrl}
                     </UniversalLink>
                   ) : '—'}
                 </DetailRow>
                 <DetailRow label="最近抓取时间">
                   {formatDateTime(detailRuntime?.lastCrawlAt ?? null)}
                 </DetailRow>
                 <DetailRow label="最后成功抓取">
                   {formatDateTime(detailRuntime?.lastSuccessAt ?? null)}
                 </DetailRow>
                 <DetailRow label="最近检查">
                   {formatDateTime(detailRuntime?.lastCheckAt ?? null)}
                 </DetailRow>
                 <DetailRow label="诊断信息">
                   {detailRuntime?.lastDiagnostic ? (
                     <span className="whitespace-pre-wrap rounded bg-muted px-2 py-1 text-left text-xs text-muted-foreground">
                       {detailRuntime.lastDiagnostic}
                     </span>
                   ) : '—'}
                 </DetailRow>
                 {detailRuntime?.lastError && (
                   <DetailRow label="失败原因">
                     <span className="text-destructive">{detailRuntime.lastError}</span>
                   </DetailRow>
                 )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

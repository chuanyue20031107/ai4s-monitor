import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Radar, Send, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { RunStatusBadge } from '@/components/ai4s-badges';
import { formatDateTime } from '@/lib/format';
import { SOURCE_SEED, WEEKDAY_OPTIONS, type TaskType } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';
import DigestContentView from './DigestContentView';
import { ImportantBoard } from './ImportantBoard';

const PIPELINE_TASKS: TaskType[] = ['来源抓取', '去重', '分类', 'AI 分析', '飞书卡片推送'];

export default function DashboardPage() {
  const {
    articles, runs, sourceRuntime, settings, digest, weeklyDigest, lastPushAt, busy,
    loaded, loadError, generateDigest, generateWeeklyDigest, pushDigest, refreshAll,
  } = useAi4s();
  const navigate = useNavigate();
  const [digestTab, setDigestTab] = useState<'daily' | 'weekly'>('daily');
  const [digestPreview, setDigestPreview] = useState('');
  const [weeklyPreview, setWeeklyPreview] = useState('');

  const stats = useMemo(() => {
    const lastCrawlAt = Object.values(sourceRuntime)
      .map((r) => r.lastCrawlAt ?? 0)
      .reduce((max, v) => Math.max(max, v), 0);
    return {
      enabledSources: Object.values(sourceRuntime).filter((r) => r.enabled).length,
      totalSources: SOURCE_SEED.length,
      healthySources: Object.values(sourceRuntime).filter((r) => r.enabled && r.crawlStatus === 'ok').length,
      lastCrawlAt: lastCrawlAt || null,
      lastAnalysisRun: runs.find((r) => r.taskType === 'AI 分析') ?? null,
    };
  }, [sourceRuntime, runs]);

  const pipeline = useMemo(
    () => PIPELINE_TASKS.map((type) => ({ type, run: runs.find((r) => r.taskType === type) ?? null })),
    [runs],
  );

  const failedRuns = useMemo(() => runs.filter((r) => r.status === 'failed').slice(0, 5), [runs]);

  const healthPercent = stats.enabledSources
    ? Math.round((stats.healthySources / stats.enabledSources) * 100)
    : 0;

  const [digestHint, setDigestHint] = useState('');

  const activeDigest = digestTab === 'daily' ? digest : weeklyDigest;
  const activePreview = digestTab === 'daily' ? digestPreview : weeklyPreview;
  const activeContent = activePreview || activeDigest?.content || '';
  const generating = digestTab === 'daily' ? busy.digest : busy.weeklyDigest;

  const handleGenerate = async () => {
    setDigestHint('');
    if (digestTab === 'daily') {
      setDigestPreview('');
      const result = await generateDigest((full) => setDigestPreview(full));
      if (!result) {
        setDigestHint('今日暂无已抓取的情报：请先到「监控来源」执行抓取，抓取完成后再点击生成摘要。');
      }
      return;
    }
    setWeeklyPreview('');
    const result = await generateWeeklyDigest((full) => setWeeklyPreview(full));
    if (!result) {
      setDigestHint('近 7 天暂无已抓取的情报：请先到「监控来源」执行抓取，抓取完成后再点击生成周报。');
    }
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Radar className="size-5 text-primary" />
            AI4S 学术活动监控
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI for Science 学术活动与产业情报雷达 · 持续监控会议、机构、模型厂商与自动化实验室
          </p>
        </div>
      </div>

      {/* 重要情报看板 */}
      <ImportantBoard
        articles={articles.filter((a) => a.analysisStatus === 'done')}
        enabledSources={stats.enabledSources}
        totalSources={stats.totalSources}
        loaded={loaded}
        loadError={loadError}
        onReload={() => {
          void refreshAll();
        }}
      />

      {/* 轻量看板（已移除） */}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">来源健康度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">{healthPercent}%</span>
              <span className="text-xs text-muted-foreground">
                {stats.healthySources}/{stats.enabledSources} 启用来源正常
              </span>
            </div>
            <Progress value={healthPercent} />
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>来源总数 {stats.totalSources}</span>
              <span>最近抓取 {formatDateTime(stats.lastCrawlAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">任务状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pipeline.map(({ type, run }) => (
              <div key={type} className="flex items-center justify-between gap-2">
                <span className="text-sm">{type}</span>
                <div className="flex items-center gap-2">
                  {run && <span className="text-xs text-muted-foreground">{formatDateTime(run.endedAt)}</span>}
                  {run ? <RunStatusBadge status={run.status} /> : <Badge variant="outline">未运行</Badge>}
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>最近一次分析</span>
              <span>{formatDateTime(stats.lastAnalysisRun?.endedAt ?? null)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">每日飞书推送</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>每日推送</span>
              <Badge variant={settings.dailyPushEnabled ? 'default' : 'outline'}>
                {settings.dailyPushEnabled ? '已启用' : '已停用'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>推送时间</span>
              <span className="tabular-nums">{settings.pushTime}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>接收人</span>
              <span>{settings.feishuReceivers.length} 位</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>每周周报</span>
              <span className="text-muted-foreground">
                {settings.weeklyReportEnabled
                  ? `已启用 · ${WEEKDAY_OPTIONS.find((w) => w.value === settings.weeklyReportDay)?.label ?? '周五'}`
                  : '已停用'}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>最近一次推送</span>
              <span>{formatDateTime(lastPushAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 失败任务 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            失败任务
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failedRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无失败任务，各环节运行正常。</p>
          ) : (
            <div className="space-y-2">
              {failedRuns.map((run) => (
                <div key={run.id} className="flex flex-col gap-1 rounded-md border px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive">{run.taskType}</Badge>
                    <span className="truncate text-sm">{run.failureReason || '未知原因'}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(run.endedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 情报日报 / 周报 */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">AI4S 情报日报 / 周报</CardTitle>
              <CardDescription>
                {activeDigest
                  ? `${digestTab === 'daily' ? '基于今日' : '基于本周'} ${activeDigest.articleCount} 篇情报生成 · ${formatDateTime(activeDigest.generatedAt)}`
                  : digestTab === 'daily'
                    ? '基于今日情报生成日报（重点情报 / 趋势观察）'
                    : '基于近 7 天情报生成周报（重点情报 + 趋势观察）'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-md border">
                <button
                  type="button"
                  onClick={() => setDigestTab('daily')}
                  className={`px-3 py-1.5 text-xs ${digestTab === 'daily' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  日报
                </button>
                <button
                  type="button"
                  onClick={() => setDigestTab('weekly')}
                  className={`px-3 py-1.5 text-xs ${digestTab === 'weekly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  周报
                </button>
              </div>
              <Button size="sm" onClick={handleGenerate} disabled={generating}>
                <Sparkles className="size-4" />
                {generating ? '生成中…' : digestTab === 'daily' ? '生成日报' : '生成周报'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => pushDigest(digestTab)}
                disabled={busy[`push:${digestTab}`]}
              >
                <Send className="size-4" />
                {busy[`push:${digestTab}`] ? '推送中…' : digestTab === 'daily' ? '推送日报' : '推送周报'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeContent ? (
            <DigestContentView content={activeContent} />
          ) : digestHint ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              {digestHint}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">暂无{digestTab === 'daily' ? '日报' : '周报'}内容。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

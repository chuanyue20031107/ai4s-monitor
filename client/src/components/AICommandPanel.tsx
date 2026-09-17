import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AI_WORKER_URL, commandCommitUrl, createAICommand, fetchAIQueue, type AICommand, type AICommandResult, type AIQueueSnapshot, type AnalysisLimit } from '@/api/aiCommands';

const LABELS: Record<AICommandResult['status'], string> = {
  pending: '等待 worker 分批', awaiting_analysis: '等待 ChatGPT 分析', completed: '本次选中条目已处理',
  partial: '部分失败，可重新提交', no_work: '本次无可新增的分析任务', rejected: '任务格式被拒绝',
};

export function AICommandPanel() {
  const [instruction, setInstruction] = useState('分析待处理的 AI4S 情报，依据原文给出分类、评分、中文摘要与限制。');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState<AnalysisLimit>(100);
  const [draft, setDraft] = useState<AICommand | null>(null);
  const [snapshot, setSnapshot] = useState<AIQueueSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true; setLoading(true);
    try { setSnapshot(await fetchAIQueue()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '队列读取失败'); }
    finally { fetching.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  const confirmed = draft && snapshot?.items.some((r) => r.id === draft.id);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">AI 任务控制中心 · 清仓模式</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">worker 将有正文的待分析文章拆为每批最多 30 篇，由 ChatGPT 分析并校验回写。清仓范围以任务执行时的数据为准。</p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="清仓批量">
          {([100, 500, 'all'] as const).map((size) => (
            <Button key={size} size="sm" variant={limit === size ? 'default' : 'outline'} aria-pressed={limit === size}
              onClick={() => { setLimit(size); setDraft(null); }}>{size === 'all' ? '全部待分析' : `${size} 篇`}</Button>
          ))}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="ai-query">范围关键词（可选，匹配标题、来源和正文；留空为全部）</label>
          <Input id="ai-query" value={query} maxLength={100} onChange={(e) => { setQuery(e.target.value); setDraft(null); }} placeholder="例如：材料" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="ai-instruction">分析要求（交给 ChatGPT，不用于自动筛选范围）</label>
          <Textarea id="ai-instruction" value={instruction} maxLength={1000} onChange={(e) => { setInstruction(e.target.value); setDraft(null); }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!instruction.trim() || Boolean(draft && !confirmed)} onClick={() => setDraft(createAICommand(instruction, limit, query))}>生成分析任务</Button>
          <Button variant="outline" asChild><a href={AI_WORKER_URL} target="_blank" rel="noreferrer">查看 / 运行 worker<ExternalLink className="size-3" /></a></Button>
        </div>
        {draft && <div className="space-y-2 rounded-md border p-3 text-sm" aria-live="polite">
          <p>{confirmed ? '已从仓库读到任务回执。' : '任务草稿已生成，尚未入队。请在 GitHub 确认文件并提交到 main；如创建 PR，合并后才会入队。'}</p>
          <code className="block break-all text-xs">data/ai-commands/pending/{draft.id}.json</code>
          {!confirmed && <Button size="sm" asChild><a href={commandCommitUrl(draft)} target="_blank" rel="noreferrer">前往 GitHub 提交<ExternalLink className="size-3" /></a></Button>}
        </div>}
        <div className="flex items-center justify-between border-t pt-4">
          <h3 className="text-sm font-medium">仓库任务队列 {snapshot ? `· ${snapshot.pendingTasks} 个批次待处理` : ''}</h3>
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}><RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />刷新</Button>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!snapshot && !error && <p className="text-sm text-muted-foreground">正在读取队列…</p>}
        {snapshot?.items.length === 0 && <p className="text-sm text-muted-foreground">暂无已提交任务。生成草稿后，完成 GitHub 提交即可开始排队。</p>}
        <div className="max-h-96 space-y-2 overflow-y-auto" aria-live="polite">
          {snapshot?.items.map((r) => <div key={r.id} className="space-y-1 rounded-md border p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{LABELS[r.status] || r.status}</span><code>{r.id}</code></div>
            <p className="break-words">{r.instruction}</p>
            <p className="text-muted-foreground">本次 {r.total} 篇 · 完成 {r.completed} · 待分析 {r.pending} · 失败 / 过期 {r.failed}</p>
            <p className="text-muted-foreground">入队时：缺正文 {r.blocked} · 已在其他任务 {r.alreadyQueued} · 超出本次数量 {r.remaining || 0}</p>
            {r.reason && <p className="text-destructive">{r.reason}</p>}
          </div>)}
        </div>
      </CardContent>
    </Card>
  );
}

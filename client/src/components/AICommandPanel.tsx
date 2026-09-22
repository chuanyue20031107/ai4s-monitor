import { useState } from 'react';
import { Bot, Check, Clipboard, FileCheck2, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const ANALYSIS_PROMPT = [
  '读取 chuanyue20031107/ai4s-monitor 的最新 main 分支数据，动态收集当前所有未分析情报，不使用任何固定数量。',
  '逐条读取 data/raw/<id>.json，核对当前 contentHash，按照 docs/chatgpt-analysis.md 生成真实中文分析。每条必须包含摘要、分类、评分及理由、contentType、moatTags、逐字证据、限制和 analyzedAt，证据必须逐字来自当前 raw.content。',
  '严格使用仓库允许的 category、contentType 和 moatTags 值；无关行政通知、导航页和目录页才标记 discarded；正文不足或证据不足只能 failed 或 pending，不能伪造 done。',
  '在本地持续循环处理全部未分析记录，保存 checkpoint；每轮重新读取 queue 和 raw，直到实时 pending=0。全部校验通过后，只新增唯一 data/inbox/*.json 批次，再等待 publisher、accepted 回执、Actions 和 Pages。',
  '只有实时 pending=0、目标全部有效完成、批次 accepted、Pages 部署成功并显示 AI已分析时才能报告完成。'
].join('\n\n');

export const DAILY_DIGEST_PROMPT = [
  '读取 https://github.com/chuanyue20031107/ai4s-monitor 的最新 main 分支，同时读取当前 Pages 实际部署的数据，生成并发布今天的 AI4S 日报。',
  '先读取 AGENTS.md、docs/chatgpt-analysis.md、data/queue.json、最近的 data/inbox/*.json、GitHub main 的 client/public/data/articles.json、digest.json、digests.json，以及 Pages 实际加载的 articles.json、analysis-status.json、digest.json、digests.json。',
  'GitHub 与 Pages 不一致时，以 Pages 当前页面实际使用的 articles 为准。严格复现 ImportantBoard：先取 analysisStatus === done，再按 crawledAt >= todayStartTs() 且 crawledAt <= todayEndTs() 筛选；项目时区为 Asia/Shanghai。',
  '不得使用 publishedAt 替代 crawledAt，不得用 queue pending、accepted 回执、batchFile、评分、来源或类别减少今日 done 数量。日报 articleIds 必须包含看板今日显示的全部 done 情报；看板显示11条时必须包含11条。',
  '逐条读取对应 rawPath，核对当前 contentHash，并确认 summary、importanceReason、evidence、limitations 与 raw 内容一致。pending、analyzing、failed、discarded 不得进入今日 done 集合。',
  '重点情报只纳入 score >= 4 的今日 done 情报；score=3 或以下不得进入重点。没有重点时写：今日暂无评分大于等于4/5且通过校验的有效情报。',
  '同一 sourceName 的重点情报合并为一条，保留全部原文 URL，摘要必须覆盖原文事实、分析判断、重要性及限制，不得凭标题补写或把企业自述改写成独立验证结论。',
  '正文只能包含【重点情报】和【趋势观察】。趋势观察基于全部今日 done 情报，说明 done 总数、重点数量、企业/机构自述数量、论文或媒体报道数量、合并来源数量，并注明有限样本，样本不足时写不能据此推断行业整体趋势。',
  '生成 digest，articleIds 为看板今日全部 done ID，pendingCount 为生成时实时值；只新增 data/inbox/<UTC时间戳>-daily-digest-<唯一后缀>.json，不直接修改 queue、receipts、digest.json、digests.json 或前端派生文件。',
  '提交后等待 receipts 对应批次 accepted、Crawl and deploy 成功，并验证 Pages digest.json 已更新且 articleIds 数量与看板今日数量完全一致；不一致时继续排查，不得报告完成。'
].join('\n\n');

const STEPS = [
  { icon: Search, title: '读取工作区数据', description: '扫描待分析记录并核对正文版本。' },
  { icon: Sparkles, title: 'Codex 自主分析', description: '基于原文生成结构化中文分析和证据。' },
  { icon: FileCheck2, title: '校验并写回', description: '校验结果后更新项目数据，页面自动展示。' },
] as const;

function CopyPrompt({ title, prompt }: { title: string; prompt: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setState('copied');
      window.setTimeout(() => setState('idle'), 2200);
    } catch {
      setState('error');
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button size="sm" onClick={() => void copy()}>
          {state === 'copied' ? <Check className="size-3" /> : <Clipboard className="size-3" />}
          {state === 'copied' ? '已复制' : '复制指令'}
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-y-auto rounded-md border bg-muted/30 p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{prompt}</pre>
      </div>
      {state === 'error' && <p className="text-xs text-destructive">复制失败，请手动选择并复制指令。</p>}
    </div>
  );
}

export function AICommandPanel() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Bot className="size-4 text-primary" />AI 分析 · Codex 工作区</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm leading-6">Codex 会直接在当前工作区读取情报、完成分析并写回项目数据。此页面只提供分析指令，不创建任务队列，也不调用外部接口。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, description }) => <div key={title} className="rounded-md border p-3"><Icon className="mb-2 size-4 text-primary" /><h3 className="text-xs font-medium">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>)}
          </div>
          <CopyPrompt title="Codex 分析指令" prompt={ANALYSIS_PROMPT} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-primary" />AI4S 日报生成指令</CardTitle></CardHeader>
        <CardContent><CopyPrompt title="日报提示词" prompt={DAILY_DIGEST_PROMPT} /></CardContent>
      </Card>
    </div>
  );
}

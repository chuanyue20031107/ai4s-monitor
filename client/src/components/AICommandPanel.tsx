import { useState } from 'react';
import { Bot, Check, Clipboard, FileCheck2, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The page is a hand-off point for the Codex agent. It deliberately has no
 * queue client or external task API: Codex reads and updates the workspace itself.
 */
export const ANALYSIS_PROMPT = [
  '读取 `chuanyue20031107/ai4s-monitor` 的最新 `main` 分支数据，动态收集当前所有未分析情报，不使用任何固定数量。',
  '你负责实际分析：逐条读取 `data/raw/<id>.json`，核对当前 `contentHash`，然后生成符合 `docs/chatgpt-analysis.md` 的真实中文分析。每条必须包含摘要、分类、评分及理由、`contentType`、`moatTags`、逐字证据、限制和 `analyzedAt`；证据必须来自当前原文。无关页面才标记 `discarded`，证据不足只能保留 `failed` 或 `pending`，不能伪造 `done`。',
  '在本地工作区持续循环处理全部记录，把每条结果先保存到本地临时目录和 checkpoint。不要在分析未全部完成前写入 GitHub，不要把 GitHub Actions 入队当作分析完成。每次循环重新读取队列和 raw，处理执行期间新增的待分析记录，直到完整扫描确认实时 `pending=0`。',
  '全部分析完成后统一校验所有 ID、`contentHash`、字段、证据和状态。校验通过后，再一次性生成全部 `data/inbox/*.json` 文件，并在一个 Git commit 中提交到仓库；允许拆成多个文件，但不能产生中间提交。随后等待 publisher，检查 `data/receipts.json`、Actions 部署和 Pages 实际数据。',
  '只有当实时 pending 为 0、所有目标均为有效 `done`、缺正文/失败为 0、Pages 部署成功并且线上文章显示为“AI已分析”时，才报告完成。报告实际动态数量、done/discarded/failed、剩余 ID、最终 commit、Actions 和 Pages 链接。不要提前结束，也不要把入队、部分分析或提交成功说成完成。',
].join('\n\n');

const STEPS = [
  { icon: Search, title: '读取工作区数据', description: '扫描待分析记录并核对正文版本。' },
  { icon: Sparkles, title: 'Codex 自主分析', description: '基于原文生成结构化中文分析和证据。' },
  { icon: FileCheck2, title: '校验并写回', description: '校验结果后更新项目数据，页面自动展示。' },
] as const;

export function AICommandPanel() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(ANALYSIS_PROMPT);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('error');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4 text-primary" aria-hidden="true" />
          AI 分析 · Codex 工作区
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm leading-6">
            Codex 会直接在当前工作区读取情报、完成分析并写回项目数据。此页面只提供分析指令，不创建任务队列，也不需要在页面中配置或调用任何外部接口。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-md border p-3">
              <Icon className="mb-2 size-4 text-primary" aria-hidden="true" />
              <h3 className="text-xs font-medium">{title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Codex 分析指令</h3>
              <p className="text-xs text-muted-foreground">复制后交给当前 Codex 会话执行。</p>
            </div>
            <Button size="sm" onClick={() => void copyPrompt()} aria-label="复制 Codex 分析指令">
              {copyState === 'copied' ? <Check className="size-3" aria-hidden="true" /> : <Clipboard className="size-3" aria-hidden="true" />}
              {copyState === 'copied' ? '已复制' : '复制指令'}
            </Button>
          </div>
          <div className="max-h-[32rem] overflow-y-auto rounded-md border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{ANALYSIS_PROMPT}</pre>
          </div>
          {copyState === 'error' && <p className="text-xs text-destructive" role="alert">复制失败，请手动选择并复制指令。</p>}
        </div>
      </CardContent>
    </Card>
  );
}

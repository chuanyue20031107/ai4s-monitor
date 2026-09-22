import { useState } from 'react';
import { Bot, Check, Clipboard, FileCheck2, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The page is a hand-off point for the Codex agent. It deliberately has no
 * queue client or external task API: Codex reads and updates the workspace itself.
 */
export const ANALYSIS_PROMPT = [
  '你是当前 ai4s-monitor 工作区的 AI4S 情报分析代理。直接读取仓库现有数据，找出所有仍需分析的记录；数量以本次扫描结果为准，不要使用固定批量或预设 ID。',
  '逐条读取 data/raw/<id>.json，核对最新 contentHash 和正文。依据原文生成真实中文分析：摘要、分类、评分及理由、contentType、moatTags、逐字证据、限制和 analyzedAt。无关页面才标记 discarded；证据不足标记 failed 或保留 pending，绝不补造结论。',
  '在当前 Codex 工作区完成读取、分析、校验和写入。不要创建分析队列、worker、Actions 任务或额外的 API 请求；不要把“已安排”或“已部分处理”当成完成。分析过程中定期重新扫描待处理数据，直到确认没有遗漏。',
  '校验所有 ID、contentHash、字段、证据和状态后，把结果写入项目现有的数据格式和目录，并保留可恢复的 checkpoint。写入完成后再次读取结果，确认页面能显示最新状态，再报告实际处理数量和失败项。',
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

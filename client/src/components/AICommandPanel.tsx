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
  '你负责实际分析：逐条读取 `data/raw/<id>.json`，核对当前 `contentHash`，然后生成符合 `docs/chatgpt-analysis.md` 的真实中文分析。每条必须包含摘要、分类、评分及理由、`contentType`、`moatTags`、逐字证据、限制和 `analyzedAt`；证据必须来自当前原文，且每个 quote 必须逐字包含在对应 raw 的 `content` 中。',
  '严格使用仓库允许值：`category` 只能是 `模型`、`数据`、`AI4S 应用`、`自动化实验室`、`产业与商业`、`其他`；`contentType` 只能是 `company_claim`、`paper_result`、`media_report`；`moatTags` 只能是 `数据`、`模型`、`实验自动化`、`药物设计`、`材料发现`、`商业合作`、`人才`。不要创造“科研进展”“材料与化学”等自定义分类。',
  '状态必须严格区分：与 AI4S 无关且正文确实是行政通知、导航页或目录页才用 `discarded`；正文不足、证据不足或无法可靠判断才用 `failed` 并填写具体 `failureReason`；`pending` 只表示暂不提交、继续留在本地 checkpoint，不能作为已完成结果写进 inbox；只有所有字段和证据都通过校验才可用 `done`，绝不为了清零伪造 done。',
  '在本地工作区持续循环处理全部记录，把每条结果先保存到本地临时目录和 checkpoint。每轮重新读取 `data/queue.json`、所有目标 `data/raw/<id>.json` 和新增记录，直到完整扫描确认实时 `pending=0`。不要在分析未全部完成前写入 GitHub，不要创建任务队列、worker、Actions 入队或额外 API 请求。',
  '提交前必须做本地预检：逐条复核 ID、`contentHash`、正文长度、状态、时间、允许分类/类型/标签、摘要长度、理由、证据 URL、quote 长度及 `raw.content.includes(quote)`；然后运行 `node scripts/pipeline.mjs`（必要时先运行 `node --test tests/pipeline.test.mjs`）。只要有一条 rejected 或校验错误，就继续修正并重新运行，禁止提交该批次。',
  '全部目标均通过本地校验后，再一次性生成全部 `data/inbox/*.json` 文件，并在一个 Git commit 中提交到仓库；允许拆成多个文件，但不能产生中间提交。随后等待 publisher，重新读取 `data/receipts.json`、`data/queue.json`、`client/public/data/analysis-status.json`、Actions 部署和 Pages 实际数据；只有 receipts 对应批次为 `accepted` 且线上数据更新才算发布成功。',
  '只有当实时 `pending=0`、所有目标均为有效 `done` 或有明确依据的 `discarded`、缺正文/失败为 0、批次 accepted、Pages 部署成功并且线上文章显示为“AI已分析”时，才报告完成。报告实际动态数量、done/discarded/failed、剩余 ID、每个 rejected 原因、最终 commit、Actions 和 Pages 链接。不要提前结束，也不要把入队、部分分析、Actions success 或 commit 成功说成完成。',
].join('\n\n');

const STEPS = [
  { icon: Search, title: '读取工作区数据', description: '扫描待分析记录并核对正文版本。' },
  { icon: Sparkles, title: 'Codex 自主分析', description: '基于原文生成结构化中文分析和证据。' },
  { icon: FileCheck2, title: '校验并写回', description: '校验结果后更新项目数据，页面自动展示。' },
] as const;

export function AICommandPanel() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');\n  const [digestCopyState, setDigestCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const copyDigestPrompt = async () => {\n    try {\n      await navigator.clipboard.writeText(DAILY_DIGEST_PROMPT);\n      setDigestCopyState('copied');\n      window.setTimeout(() => setDigestCopyState('idle'), 2200);\n    } catch {\n      setDigestCopyState('error');\n    }\n  };\n\n  const copyPrompt = async () => {
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
    </Card>\n\n    <Card>\n      <CardHeader>\n        <CardTitle className="flex items-center gap-2 text-sm">\n          <Sparkles className="size-4 text-primary" aria-hidden="true" />\n          AI4S 日报生成指令\n        </CardTitle>\n      </CardHeader>\n      <CardContent className="space-y-3">\n        <div className="flex flex-wrap items-center justify-between gap-2">\n          <p className="text-xs text-muted-foreground">复制后交给当前 Codex 会话执行，范围与重要情报看板保持一致。</p>\n          <Button size="sm" onClick={() => void copyDigestPrompt()} aria-label="复制 AI4S 日报生成指令">\n            {digestCopyState === 'copied' ? <Check className="size-3" aria-hidden="true" /> : <Clipboard className="size-3" aria-hidden="true" />}\n            {digestCopyState === 'copied' ? '已复制' : '复制指令'}\n          </Button>\n        </div>\n        <div className="max-h-[32rem] overflow-y-auto rounded-md border bg-muted/30 p-4">\n          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{DAILY_DIGEST_PROMPT}</pre>\n        </div>\n        {digestCopyState === 'error' && <p className="text-xs text-destructive" role="alert">复制失败，请手动选择并复制指令。</p>}\n      </CardContent>\n    </Card>
  );
}

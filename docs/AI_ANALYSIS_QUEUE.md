# AI 分析任务队列

GitHub Actions 负责入队、分批与校验；ChatGPT 负责真实文章分析。worker 不调用模型 API，
不调用 Codex，不生成伪摘要，不需要模型密钥。RSS crawler 与六小时 schedule 保持原样。

## 提交任务

在「AI 分析任务」选择 100 / 500 / 全部待分析，可填范围关键词与分析要求。
点击「生成分析任务」只创建草稿；「前往 GitHub 提交」打开预填的 JSON 文件页面。
登录有写权限的 GitHub 账号，将文件提交到 main（分支保护启用时先建 PR 并合并）才会真正入队。
前端不会把打开页面或生成草稿显示为成功。回执读取仓库的真实快照，30 秒刷新，也支持手动刷新。

也可在 **AI analysis worker** 的 Run workflow 里选择 batch_size=100/500/all；
existing 仅处理已有请求。相同 Actions run 的重跑使用同一请求 ID，不重复创建清仓任务。
工作流只在 main 上写数据，触发器为 workflow_dispatch 与 push data/ai-commands/**。

请求文件为 `data/ai-commands/pending/<唯一id>.json`，例如：

```json
{
  "schemaVersion": 1,
  "id": "example-command-0001",
  "type": "analyze",
  "limit": 100,
  "instruction": "依据原文分析材料科学进展，区分来源自述与研究结论。",
  "query": "材料",
  "createdAt": "2026-09-17T00:00:00Z"
}
```

limit 只接受数字 100、500 或字符串 all。query 是标题、来源、正文的字面关键词，
instruction 交给 ChatGPT；不会自动理解其中的数量或过滤条件。请求 ID 为 8–80 位字母、数字、
下划线、横线，必须与文件名一致。已接收的请求不可覆盖；更改需求应使用新 ID。

## 分批和状态

- 原始请求保留于 pending，作为不可变的审计记录；是否完成以 results 回执为准，不以目录名为准。
- `data/ai-commands/tasks/*.json`：每批最多 30 条，保留 articleId 对应的 id、contentHash、rawPath。
- `data/ai-commands/queue.json`：ChatGPT 应优先消费的未完成批次索引。
- `data/ai-commands/results/*.json`：请求状态、数量和拒绝原因。
- `client/public/data/ai-commands.json`：页面只读回执。

worker 按发布时间（缺失时按抓取时间）从新到旧选有正文的未完成文章，跳过 done、discarded
及已有任务占用的同一 id/contentHash。100/500 是本次新增任务上限；all 是本次可分析积压的快照，
不自动包含未来新增文章。无正文条目不进入分析，回执中的 blocked、alreadyQueued、remaining
分别表示入队时缺正文、其他任务已排队、超过本次上限的数量。

请求状态：pending 等待 worker；awaiting_analysis 等待 ChatGPT；completed 本次选中条目均
done/discarded；partial 有 failed/过期条目；no_work 没有可新增任务；rejected 格式错误或请求被覆盖。
completed 不表示所有历史积压已清空。

Articles 的 analyzing 表示已分派、等待 ChatGPT 的任务条目，并不代表模型正在实时生成。
「待AI分析」= pending/analyzing；「AI已分析」= done。Dashboard ImportantBoard 只接收 done。

## 分析回写与恢复

ChatGPT 执行 [chatgpt-analysis.md](chatgpt-analysis.md) 的协议，只新建 inbox 批次。
原有发布器验证正文哈希、证据摘录及结构，只有通过校验的结果才能推进任务；不需要额外改写任务文件。
有效结果为 failed 时释放条目以供新任务重试。正文哈希变化使旧任务过期，可生成新任务分析新版本。

重新运行 worker 不重复拆分同一请求；多个重叠请求按文件名稳定处理，并去重保留已有批次。
worker 使用独立并发组，不取消 RSS 运行。与其他写入者冲突时拒绝覆盖，保留 7 天队列 artifact，
等待其他任务完成后重新运行。成功持久化后以 collect=false 显式调用现有发布工作流。
ChatGPT 任务未启动或不可用时，队列保持等待，不声称 AI 分析完成。

## 验证

```sh
node --test tests/ai-commands.test.mjs tests/pipeline.test.mjs
npm run typecheck
npm run build
```

已有自动 ChatGPT 分析任务每次读取分析协议时会看到新优先队列流程；
本次代码改造不创建或修改任何 ChatGPT 定时任务，也不改变其分析频率。

# AI4S Monitor

GitHub 原生 AI for Science 情报监控：GitHub Actions 采集与发布，Codex 自主读取证据并分析写回，GitHub 版本化 JSON 存储，GitHub Pages 展示。

```text
Actions 定时抓取 -> data/raw + data/queue
Codex 工作区 -> 读取正文并分析 -> data/inbox 新批次
Actions -> 校验来源/字段/哈希 -> articles + 日报历史 -> Pages
```

完整约定及批次格式见 [Codex 分析协议](docs/chatgpt-analysis.md)。截图规则仍待确认，当前沿用项目已有字段。

## 运行

```sh
npm install
node --test tests/pipeline.test.mjs
npm run typecheck
npm run crawl
npm run build
npm run dev
```

只校验并发布现有数据：`node scripts/pipeline.mjs`。不会把抓取成功标成 AI 分析完成，不用标题规则冒充日报。

## 数据与任务

原始数据在 `data/raw/`，待分析索引在 `data/queue.json`，Codex 每次向 `data/inbox/` 新建 JSON 批次。`data/receipts.json` 记录是否被系统接受。派生数据在 `client/public/data/`，日报归档在 `digests.json`。历史 `data/ai-commands/` 仅作审计，不再分派或消费分析任务；迁移前的旧规则结果备份至 `data/legacy/`。

数据文件属于轻量级文件式存储，不是独立数据库。仓库公开，原始资料也公开；不要提交密钥、个人敏感信息或未经授权的全文。Pages 构建只复制前端导出数据，不复制 data/raw。

工作流每6小时轮转36个来源，每来源最多处理3篇。首次上线且没有 data/state.json 时执行一次有界初始化采集，其后分析回写只发布，不重复触发采集。分析由 Codex 自主执行并写回，不创建 GitHub 分析任务。

公众号配置保留 `config/wechat_sources.csv`。WeRSS 入口依次读取 `WERSS_BASE_URL` Secret、同名 Repository Variable，最后使用 main 已配置的公开 Railway 入口。无须把公开入口重新设为 Secret；非公开凭据仍不能写进代码。每个公众号仍需填写 feed_id 并 enabled=true；未配置来源不当作已接入。

## 部署与权限

Settings -> Pages -> Build and deployment 选择 GitHub Actions。未启用 Pages 或无法读取 Pages 配置时，工作流仍保存数据并发出警告，但不能据此声称网页已更新。

前端只读；Codex 通过授权工作区写入唯一分析批次，Actions 只负责采集、校验、发布。旧的浏览器本地“生成摘要”已停止提供规则假摘要。提交后须用收据和部署记录验证闭环。

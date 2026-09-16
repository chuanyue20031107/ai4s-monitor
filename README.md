# AI4S Monitor

GitHub 原生 AI for Science 情报监控：GitHub Actions 采集，ChatGPT 定时任务分析，GitHub 版本化 JSON 存储，GitHub Pages 展示。

```text
Actions 定时抓取 -> data/raw + data/queue
ChatGPT Scheduled -> 读取正文并分析 -> data/inbox 新批次
Actions -> 校验来源/字段/哈希 -> articles + 日报历史 -> Pages
```

完整约定及批次格式见 [ChatGPT 分析协议](docs/chatgpt-analysis.md)。截图规则仍待确认，当前沿用项目已有字段。

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

原始数据在 `data/raw/`，待分析索引在 `data/queue.json`，ChatGPT 每次向 `data/inbox/` 新建 JSON 批次。`data/receipts.json` 记录是否被系统接受。派生数据在 `client/public/data/`，日报归档在 `digests.json`。迁移前的旧规则结果备份至 `data/legacy/`。

数据文件属于轻量级文件式存储，不是独立数据库。仓库公开，原始资料也公开；不要提交密钥、个人敏感信息或未经授权的全文。Pages 构建只复制前端导出数据，不复制 data/raw。

工作流每6小时轮转36个来源，每来源最多处理3篇，ChatGPT分析任务另行在Scheduled创建。公众号配置保留 `config/wechat_sources.csv` 及 `WERSS_BASE_URL` Secret；未配置来源不会被当作已接入。

## 部署与权限

Settings -> Pages -> Build and deployment 选择 GitHub Actions。未启用 Pages 或无法读取 Pages 配置时，工作流仍保存数据并发出警告，但不能据此声称网页已更新。

前端只读；写入经授权 GitHub 工具/Actions 完成。旧的浏览器本地“生成摘要”已停止提供规则假摘要。ChatGPT Scheduled 任务依赖支持的 GitHub 连接及写入批准；创建任务后须用收据和部署记录验证闭环，不保证绕过审批无人值守运行。

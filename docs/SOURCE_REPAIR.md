# 失败来源诊断与修复

保持 React/Vite、版本化 JSON、GitHub Actions 架构。`crawl-and-deploy.yml` 原样保留：`17 */6 * * *`，默认批量 36。新增 `source-repair.yml` 每天 `0 3 * * *`（UTC，即北京时间 11:00）运行。

## 首次执行

1. 来源页点击“自动诊断”，在既有 GitHub Issue 表单提交请求；或在 Source repair Action 手动选择 `diagnose`。只诊断 `network_error`、`timeout`、`failed`，不全量重抓、不抓正文。
2. 查看 `client/public/data/source-diagnostics.json` 与页面“来源问题修复”表。DNS、HTTPS、robots、HTTP 状态、RSS 和 Sitemap 分开记录。探测超时/预算耗尽显示未确认，不宣称入口不存在。
3. 点击“自动修复可用来源”，提交请求。仅使用 24 小时内、与当前来源入口一致的诊断；再次验证内容和 robots 后优先 RSS、其次 Sitemap。停用来源、公众号私密配置和未验证入口保留人工处理。
4. 再点击“重试失败来源”。切换策略不代表抓取成功；原失败状态保留至实际抓取成功。

定时维护会先诊断、再验证修复，然后最多重抓本轮修复的 12 个来源，其余进入原定时轮询。手动 Action 默认仅诊断且不重抓；可明确选择 `repair` 和 `recrawl_repaired`。没有固定恢复比例，数量以真实检查为准。

## 数据与边界

- `failureType` 保存具体原因；`repairSuggestion` 保存建议；`autoRepairAvailable` 仅表示可验证切换入口。`lastError` 不因诊断或切换策略被清空。
- RSS/Atom 检查 XML 根元素和可解析文章；空 RSS、纯导航或视频 Sitemap 不作为可修复入口。Sitemap 支持 urlset 和索引，最多读 4 个 sitemap、扫描 100 个候选文章。正文和标题必须取自真实页面，Sitemap 的 lastmod 不冒充文章发布时间。
- 仅尝试公开入口、页面声明的订阅和 robots 声明的 Sitemap，以及少量常用同站路径；不解验证码，不绕过 robots，不写出 WeRSS 地址。
- 抓取阶段网络/超时失败后等待 30 秒再试，仍失败则等待 2 分钟再试；最多三次请求。HTTP 错误（含 403）、robots、证书/格式/配置错误不重试。旧 `retryCount` 设置保留兼容，新的固定网络重试策略不使用它。
- 耗尽重试的来源保留失败状态，供既有失败队列筛选；诊断阶段不做这两次长等待。失败的 DNS/robots 请求不缓存，确保后续重试会重新请求。
- 单轮收集最多使用 20 分钟网络时间；维护重抓共用 25 分钟预算，达到预算后保留失败队列，给既有 Action 留出持久化时间。
- 不变更六小时任务的 cron、batch size、游标和设置。并发数据冲突时拒绝覆盖，并保留诊断 artifact，需重新执行。
- 定时维护提交 JSON 后，来源页“刷新结果”直接读取仓库最新数据；Pages 静态快照随下一次原定发布更新。现有手动来源操作仍按原流程发布 Pages。

## 本地命令

```sh
node scripts/source-health-diagnose.mjs
node scripts/source-health-diagnose.mjs --saved --repair
# 如重抓被中断，继续本次报告中尚待重抓的修复来源（最多 12 个）：
RECRAWL_REPAIRED=true node scripts/source-repair.mjs --recrawl-saved
node --test tests/*.test.mjs
npm run typecheck
npm run build
```

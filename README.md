# AI4S Monitor

完全运行在 GitHub 上的 AI for Science 情报监控站：

- GitHub Actions 每 6 小时轮转抓取来源；
- `client/public/data/*.json` 是版本化 JSON 数据库；
- GitHub Pages 托管只读 React 前端；
- 不依赖妙搭、外部数据库、私有能力网关或常驻服务器。

## 架构

```text
GitHub Actions (cron / manual)
  -> scripts/crawl.mjs
  -> client/public/data/*.json
  -> commit to main
  -> Vite build
  -> GitHub Pages
```

## 本地运行

```bash
npm install
npm run crawl
npm run dev
```

## 自动抓取

工作流位于 `.github/workflows/crawl-and-deploy.yml`。它每 6 小时抓取一批来源并轮转游标，也支持在 Actions 页面手动运行和指定批量大小。

配置保存在 `client/public/data/settings.json`；抓取后的文章、来源状态和运行记录均写回同一数据目录。Git 历史同时充当备份和审计日志。

## GitHub Pages

仓库 Settings → Pages → Build and deployment 需选择 **GitHub Actions**。部署完成后的地址为：

`https://chuanyue20031107.github.io/ai4s-monitor/`

## 约束

GitHub Pages 是静态托管，因此网页不能直接写回数据库。需要立即抓取时，在仓库 Actions 页面运行 `Crawl and deploy`；结果会自动提交并重新发布。

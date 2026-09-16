# 微信公众号 RSS 接入（静态站架构）

当前项目由 GitHub Actions 定时执行 `scripts/crawl.mjs`，抓取结果写入 `client/public/data/*.json`，随后构建并部署 GitHub Pages。

微信公众号通过独立 WeRSS 服务转换为标准 RSS，再作为额外来源并入现有抓取脚本。不会恢复旧版 `server/` 目录，也不依赖数据库服务。

## 安全设计

- 现有 `client/src/data/ai4s-sources.ts` 完全不修改。
- `WERSS_BASE_URL` 未设置时，微信来源全部忽略，原抓取行为不变。
- `config/wechat_sources.csv` 中只有同时满足 `feed_id` 非空且 `enabled=true` 的记录才会进入抓取队列。
- 当前全部公众号默认 `feed_id` 为空、`enabled=false`，因此合并代码后不会立刻增加微信抓取流量。
- 微信 RSS 与网站抓取共用现有 URL 去重、分类、评分、JSON 输出和 Pages 部署流程。

## 文件

- `config/wechat_sources.csv`：59 个唯一公众号来源注册表。
- `docker-compose.wechat.yml`：独立 WeRSS 容器部署。
- `.env.wechat.example`：WeRSS 环境变量示例。
- `scripts/crawl.mjs`：仅增加可选微信 RSS source loader。
- `.github/workflows/crawl-and-deploy.yml`：将可选 GitHub Secret `WERSS_BASE_URL` 传入抓取脚本。

## 部署 WeRSS

在一台可长期运行 Docker 的服务器或容器平台上：

```bash
cp .env.wechat.example .env.wechat
# 修改 WERSS_PASSWORD 等配置
docker compose --env-file .env.wechat -f docker-compose.wechat.yml up -d
```

健康检查：

```bash
curl http://localhost:8001/api/health
```

生产环境应通过 HTTPS 反向代理暴露 WeRSS，并限制管理端访问。

GitHub-hosted runner 必须能访问 RSS 地址，因此 `WERSS_BASE_URL` 不能填写 `localhost` 或内网地址。

## 绑定公众号

1. 登录 WeRSS。
2. 按 WeRSS 当前版本的方式绑定微信账号。
3. 添加目标公众号订阅。
4. 取得对应 `feed_id`。
5. 先只选择少量测试公众号，例如 DeepSeek、深势科技、晶泰科技 XtalPi。
6. 在 `config/wechat_sources.csv` 中填写 `feed_id`，并将对应 `enabled` 改为 `true`。

WeRSS 当前支持标准 Feed 路径：

```text
/feed/{feed_id}.xml
```

## 配置 GitHub Secret

在仓库 Actions secrets 中添加：

```text
WERSS_BASE_URL=https://your-werss-host.example/
```

工作流中没有该 Secret 时，微信 RSS loader 返回空数组，不影响现有来源。

## 验证步骤

建议分阶段启用：

1. 只启用 1 个公众号。
2. 手动运行 `Crawl and deploy` workflow。
3. 检查 `client/public/data/sources.json` 是否出现该公众号。
4. 检查 `articles.json` 是否出现来自该公众号的新文章。
5. 检查既有来源数量、抓取状态和页面是否正常。
6. 再扩展到 3 个测试公众号。
7. 稳定后逐批启用剩余公众号。

## 回滚

出现问题时有三层快速止损方式：

- 删除或清空 GitHub Secret `WERSS_BASE_URL`：立即停止所有微信 RSS 注入，现有抓取逻辑继续运行。
- 将 CSV 中微信来源设为 `enabled=false`：逐来源停用。
- 回滚本次提交：恢复到完全未接入微信 RSS 的状态。

# 微信公众号 RSS 接入

本项目通过 WeRSS 把微信公众号文章转换成标准 RSS，再复用 AI4S Monitor 已有的 RSS 抓取、URL 去重、AI 分析、摘要和推送链路。

## 1. 当前配置清单

`config/wechat_sources.csv` 已根据 `AI4S咨询信息源与主体清单_修订版_2026-09-11.xlsx` 整理。

- 原始公众号-主体关系：62 条
- 去重后唯一公众号：59 个
- 3 个重复公众号被合并到同一个 RSS 来源：深势科技、中国化学会、中国药学会
- 初始 `feed_id` 为空、`enabled=false`，因此不会被误抓取

字段说明：

| 字段 | 说明 |
| --- | --- |
| `source_key` | AI4S Monitor 内唯一来源键 |
| `account_name` | 微信公众号名称 |
| `entity_name` | 对应主体；同一公众号关联多个主体时用 `；` 合并 |
| `group_name` | 来源分组 |
| `priority` | S/A/B 优先级 |
| `feed_id` | WeRSS 中对应订阅的 feed id |
| `enabled` | 是否启用抓取 |

## 2. 启动 WeRSS

先复制环境变量模板并修改账号密码：

```bash
cp .env.wechat.example .env.wechat
```

然后启动：

```bash
docker compose --env-file .env.wechat -f docker-compose.wechat.yml up -d
```

健康检查：

```bash
curl http://localhost:8001/api/health
```

默认管理端口是 `8001`。生产环境务必修改 `WERSS_PASSWORD`，并建议通过反向代理加 HTTPS 与访问控制。

## 3. 在 WeRSS 中绑定微信公众号

登录 WeRSS 后，逐个添加 `config/wechat_sources.csv` 中的公众号。

建议优先顺序：

1. S 级来源
2. A 级来源
3. B 级来源

每个公众号在 WeRSS 中建立订阅后，将对应 `feed_id` 填回 CSV。WeRSS 当前支持标准 Feed 路由：

```text
/feed/{feed_id}.xml
```

例如：

```text
http://localhost:8001/feed/abc123.xml
```

只有在 `feed_id` 已填写并验证可访问后，再把该行 `enabled` 改为 `true`。

## 4. 同步到 AI4S Monitor

AI4S Monitor 新增接口：

```text
POST /api/ai4s/sources/wechat-rss/sync
```

脚本会读取 `config/wechat_sources.csv`，并把每个 `feed_id` 组装成 RSS 地址写入现有 `ai4s_source.feed_url`。来源会使用：

```text
crawl_strategy = rss
type = 微信公众号
wechat = 公众号名称
```

建议先 dry-run：

```bash
set -a
source .env.wechat
set +a
DRY_RUN=true node scripts/sync-wechat-rss.mjs
```

确认输出无误后正式写入：

```bash
DRY_RUN=false node scripts/sync-wechat-rss.mjs
```

没有 `feed_id` 的行会被服务端强制设为 `enabled=false`，即使 CSV 中误填了 `enabled=true` 也不会进入抓取任务。

## 5. 验证单个公众号

同步后，在 AI4S Monitor 来源列表中找到目标公众号，先执行来源测试，再执行单来源抓取。

现有接口可直接复用：

```text
POST /api/ai4s/sources/:id/test
POST /api/ai4s/sources/:id/crawl
```

抓取成功后，文章会继续进入已有流程：

```text
WeRSS RSS
  -> ai4s.feed-parser
  -> URL 去重
  -> AI 结构化分析
  -> ai4s_article
  -> 日报/周报/飞书推送
```

## 6. 推荐上线顺序

不要一次性把 59 个来源全部启用。建议：

1. 先配置 3~5 个 S 级公众号做冒烟测试
2. 连续观察 1~2 天抓取稳定性和微信账号风控情况
3. 再扩展至全部 S 级
4. 最后逐步开放 A/B 级

公众号抓取依赖微信侧页面和登录状态，不应把它当作官方稳定 API。WeRSS 是采集适配层，AI4S Monitor 的业务分析逻辑与它解耦；以后即使更换公众号采集器，只要还能输出标准 RSS，就不需要改下游分析链路。

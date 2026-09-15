/**
 * AI4S 情报雷达 — 主业务服务（DB 读写 + 每日自动任务链路）
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, isNotNull, ne } from 'drizzle-orm';
import {
  ai4sArticle,
  ai4sDigest,
  ai4sRun,
  ai4sSettings,
  ai4sSource,
} from '@server/database/schema';
import type {
  Ai4sCrawlStrategy,
  IAi4sArticle,
  IAi4sCrawlAllStartResponse,
  IAi4sDigest,
  IAi4sHealthCheckStartResponse,
  IAi4sHealthCheckStats,
  IAi4sRunRecord,
  IAi4sSettings,
  IAi4sSource,
  IAi4sTestSourceResponse,
} from '@shared/api.interface';
import { digestToFeishuMarkdown } from '@shared/digest';
import { buildFeishuCardElements, renderFeishuMarkdownBudget } from '@shared/feishu-card';
import { Ai4sPluginService } from './ai4s.plugins';
import { Ai4sIngestService, type IngestStats } from './ai4s.ingest.service';
import { Ai4sHealthService } from './ai4s.health.service';

type ArticleRow = typeof ai4sArticle.$inferSelect;
type SourceRow = typeof ai4sSource.$inferSelect;
type SettingsRow = typeof ai4sSettings.$inferSelect;
type RunRow = typeof ai4sRun.$inferSelect;
type DigestRow = typeof ai4sDigest.$inferSelect;

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export interface DailyTaskResult {
  sourcesTotal: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  articlesInserted: number;
  articlesAnalyzed: number;
  articlesFailed: number;
  digestGenerated: boolean;
  pushed: boolean;
  pushMessage: string;
  weeklyGenerated: boolean;
  weeklyPushMessage: string;
}

@Injectable()
export class Ai4sService {
  private readonly logger = new Logger(Ai4sService.name);

  /** 服务重启后，把遗留的 running 任务标记为失败（后台任务随旧进程丢失） */
  async onModuleInit(): Promise<void> {
    const stale = await this.db
      .update(ai4sRun)
      .set({ status: 'failed', finishedAt: new Date(), failureReason: '服务重启，后台任务中断' })
      .where(eq(ai4sRun.status, 'running'))
      .returning({ id: ai4sRun.id });
    if (stale.length > 0) {
      this.logger.log(`已清理 ${stale.length} 条因服务重启中断的运行记录`);
    }
  }

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly plugins: Ai4sPluginService,
    private readonly ingest: Ai4sIngestService,
    private readonly health: Ai4sHealthService,
  ) {}

  // ---------- 序列化 ----------

  toArticle(row: ArticleRow): IAi4sArticle {
    return {
      id: row.id,
      title: row.title,
      sourceKey: row.sourceKey ?? '',
      sourceName: row.sourceName ?? '',
      sourceType: row.sourceType ?? '',
      category: row.category ?? '',
      publishedAt: iso(row.publishedAt),
      crawledAt: iso(row.crawledAt) ?? '',
      summary: row.summary ?? '',
      score: row.score,
      importanceReason: row.importanceReason ?? '',
      contentType: row.contentType ?? '',
      moatTags: Array.isArray(row.moatTags) ? row.moatTags.map((t) => String(t)) : [],
      url: row.url,
      analysisStatus: row.analysisStatus as IAi4sArticle['analysisStatus'],
      failureReason: row.failureReason ?? '',
    };
  }

  toSource(row: SourceRow): IAi4sSource {
    return {
      id: row.id,
      sourceKey: row.sourceKey,
      name: row.name,
      groupName: row.groupName ?? '',
      type: row.type ?? '',
      region: row.region ?? '',
      directions: row.directions ?? '',
      products: row.products ?? '',
      representative: row.representative ?? '',
      website: row.website ?? '',
      wechat: row.wechat ?? '',
      linkedin: row.linkedin ?? '',
      github: row.github ?? '',
      feedUrl: row.feedUrl ?? '',
      priority: row.priority as IAi4sSource['priority'],
      notes: row.notes ?? '',
      enabled: row.enabled,
      crawlStrategy: row.crawlStrategy as Ai4sCrawlStrategy,
      discoveredFeedUrl: row.discoveredFeedUrl,
      crawlStatus: row.crawlStatus as IAi4sSource['crawlStatus'],
      lastCrawlAt: iso(row.lastCrawlAt),
      lastSuccessAt: iso(row.lastSuccessAt),
      lastDiagnostic: row.lastDiagnostic,
      lastCheckAt: iso(row.lastCheckAt),
      lastError: row.lastError ?? '',
    };
  }

  toSettings(row: SettingsRow): IAi4sSettings {
    return {
      dailyCrawlEnabled: row.dailyCrawlEnabled,
      dailyPushEnabled: row.dailyPushEnabled,
      pushTime: row.pushTime,
      feishuReceivers: Array.isArray(row.feishuReceivers) ? row.feishuReceivers.map((r) => String(r)) : [],
      groupWebhookUrl: row.groupWebhookUrl ?? '',
      weeklyReportEnabled: row.weeklyReportEnabled,
      weeklyReportDay: row.weeklyReportDay,
      concurrency: row.concurrency,
      retryCount: row.retryCount,
      timeoutSeconds: row.timeoutSeconds,
      minScore: row.minScore,
      focusCategories: Array.isArray(row.focusCategories) ? row.focusCategories.map((c) => String(c)) : [],
      retentionDays: row.retentionDays,
      crawlWindowStart: row.crawlWindowStart,
      crawlWindowEnd: row.crawlWindowEnd,
      lastRunAt: iso(row.lastRunAt),
    };
  }

  toRun(row: RunRow): IAi4sRunRecord {
    return {
      id: row.id,
      taskType: row.taskType,
      status: row.status as IAi4sRunRecord['status'],
      processed: row.processed,
      succeeded: row.succeeded,
      failed: row.failed,
      detail: row.detail ?? '',
      failureReason: row.failureReason ?? '',
      startedAt: iso(row.startedAt) ?? '',
      finishedAt: iso(row.finishedAt),
    };
  }

  toDigest(row: DigestRow): IAi4sDigest {
    return {
      id: row.id,
      content: row.content,
      articleCount: row.articleCount,
      generatedAt: iso(row.generatedAt) ?? '',
      digestType: (row.digestType as 'daily' | 'weekly') ?? 'daily',
    };
  }

  // ---------- 查询 ----------

  async listArticles(): Promise<IAi4sArticle[]> {
    const rows = await this.db
      .select()
      .from(ai4sArticle)
      .where(ne(ai4sArticle.analysisStatus, 'discarded'))
      .orderBy(desc(ai4sArticle.crawledAt))
      .limit(500);
    return rows.map((r) => this.toArticle(r));
  }

  async getArticle(id: string): Promise<IAi4sArticle> {
    const rows = await this.db.select().from(ai4sArticle).where(eq(ai4sArticle.id, id));
    if (rows.length === 0) {
      throw new Error('情报不存在');
    }
    return this.toArticle(rows[0]);
  }

  async listSources(): Promise<IAi4sSource[]> {
    const rows = await this.db.select().from(ai4sSource).orderBy(ai4sSource.sourceKey);
    return rows.map((r) => this.toSource(r));
  }

  async listRuns(): Promise<IAi4sRunRecord[]> {
    const rows = await this.db.select().from(ai4sRun).orderBy(desc(ai4sRun.startedAt)).limit(100);
    return rows.map((r) => this.toRun(r));
  }

  async getSettings(): Promise<IAi4sSettings> {
    const rows = await this.db.select().from(ai4sSettings).limit(1);
    if (rows.length > 0) {
      return this.toSettings(rows[0]);
    }
    const inserted = await this.db.insert(ai4sSettings).values({}).returning();
    return this.toSettings(inserted[0]);
  }

  async updateSettings(patch: Partial<typeof ai4sSettings.$inferInsert>): Promise<IAi4sSettings> {
    const current = await this.db.select().from(ai4sSettings).limit(1);
    if (current.length === 0) {
      await this.getSettings();
    }
    if (Object.keys(patch).length > 0) {
      await this.db.update(ai4sSettings).set(patch);
    }
    const rows = await this.db.select().from(ai4sSettings).limit(1);
    return this.toSettings(rows[0]);
  }

  async getLatestDigest(digestType: 'daily' | 'weekly' = 'daily'): Promise<IAi4sDigest | null> {
    const rows = await this.db
      .select()
      .from(ai4sDigest)
      .where(eq(ai4sDigest.digestType, digestType))
      .orderBy(desc(ai4sDigest.generatedAt))
      .limit(1);
    return rows.length > 0 ? this.toDigest(rows[0]) : null;
  }

  async saveDigest(content: string, articleCount: number, digestType: 'daily' | 'weekly' = 'daily'): Promise<IAi4sDigest> {
    const inserted = await this.db.insert(ai4sDigest).values({ content, articleCount, digestType }).returning();
    return this.toDigest(inserted[0]);
  }

  async toggleSource(id: string): Promise<IAi4sSource> {
    const rows = await this.db.select().from(ai4sSource).where(eq(ai4sSource.id, id));
    if (rows.length === 0) {
      throw new Error('来源不存在');
    }
    await this.db.update(ai4sSource).set({ enabled: !rows[0].enabled }).where(eq(ai4sSource.id, id));
    const updated = await this.db.select().from(ai4sSource).where(eq(ai4sSource.id, id));
    return this.toSource(updated[0]);
  }

  // ---------- 手动操作 ----------

  async crawlSourceById(id: string): Promise<IngestStats> {
    const rows = await this.db.select().from(ai4sSource).where(eq(ai4sSource.id, id));
    if (rows.length === 0) {
      throw new Error('来源不存在');
    }
    const settings = await this.getSettings();
    try {
      return await this.ingest.ingestSource(rows[0], {
        retryCount: settings.retryCount,
        timeoutMs: settings.timeoutSeconds * 1000,
      });
    } catch (error) {
      await this.ingest.markSourceFailed(rows[0], error);
      throw error;
    }
  }

  /** 启动全量抓取：立即返回 runId/total，后台按并发分批执行（手动触发，不受抓取窗口限制） */
  async startCrawlAll(): Promise<IAi4sCrawlAllStartResponse> {
    const settings = await this.getSettings();
    const sources = (await this.db.select().from(ai4sSource)).filter((s) => s.enabled);
    const concurrency = Math.min(Math.max(settings.concurrency, 1), 8);
    const runId = await this.startRun(
      '全量抓取',
      `并发 ${concurrency} · 手动触发，共 ${sources.length} 个来源`,
    );
    void this.runCrawlAll(runId, sources, settings, concurrency);
    return { runId, total: sources.length };
  }

  /** 后台批量抓取全部启用来源：逐批更新进度，结束后写运行记录 */
  private async runCrawlAll(
    runId: string,
    sources: SourceRow[],
    settings: IAi4sSettings,
    concurrency: number,
  ): Promise<void> {
    let analyzedCount = await this.ingest.analyzedTodayCount();
    const budget = {
      remaining: () => Math.max(0, this.ingest.dailyAnalyzeLimit - analyzedCount),
    };
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let inserted = 0;
    let analyzed = 0;
    let failedArticles = 0;
    try {
      for (let i = 0; i < sources.length; i += concurrency) {
        const batch = sources.slice(i, i + concurrency);
        const outcomes = await Promise.allSettled(
          batch.map(async (source) => {
            const stats = await this.ingest.ingestSource(source, {
              retryCount: settings.retryCount,
              timeoutMs: settings.timeoutSeconds * 1000,
              budget,
            });
            analyzedCount += stats.analyzed;
            return stats;
          }),
        );
        outcomes.forEach((outcome, idx) => {
          processed += 1;
          if (outcome.status === 'fulfilled') {
            succeeded += 1;
            inserted += outcome.value.inserted;
            analyzed += outcome.value.analyzed;
            failedArticles += outcome.value.failedArticles;
          } else {
            failed += 1;
            void this.ingest.markSourceFailed(batch[idx], outcome.reason);
          }
        });
        await this.db
          .update(ai4sRun)
          .set({ processed, succeeded, failed })
          .where(eq(ai4sRun.id, runId));
      }
      const detail =
        `成功 ${succeeded} · 失败 ${failed} · 入库 ${inserted} 篇 · 分析 ${analyzed} 篇` +
        (failedArticles > 0 ? ` · 分析失败 ${failedArticles} 篇` : '');
      await this.finishRun(
        runId,
        succeeded > 0 ? 'success' : 'failed',
        processed,
        succeeded,
        failed,
        detail,
      );
    } catch (error) {
      const reason = String(error).slice(0, 300);
      this.logger.error(`全量抓取任务失败: ${reason}`);
      await this.finishRun(runId, 'failed', processed, succeeded, failed, reason);
    }
  }

  /** 启动全量健康检查（后台异步执行） */
  async startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
    return this.health.startHealthCheck();
  }

  /** 健康检查聚合统计 */
  async getHealthCheckStats(): Promise<IAi4sHealthCheckStats> {
    return this.health.getHealthCheckStats();
  }

  /** 单来源测试：检查后回读最新 source 行一并返回 */
  async testSourceById(id: string): Promise<IAi4sTestSourceResponse> {
    const rows = await this.db.select().from(ai4sSource).where(eq(ai4sSource.id, id));
    if (rows.length === 0) {
      throw new Error('来源不存在');
    }
    const result = await this.health.testSource(rows[0]);
    const updated = await this.db.select().from(ai4sSource).where(eq(ai4sSource.id, id));
    return { result, source: this.toSource(updated[0]) };
  }

  /** 当前上海时间 HH:mm */
  private shanghaiHm(): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  /** 是否在配置的抓取窗口内（支持跨夜窗口：start > end 时为 now>=start || now<end） */
  private inCrawlWindow(settings: IAi4sSettings): boolean {
    const now = this.shanghaiHm();
    const { crawlWindowStart: start, crawlWindowEnd: end } = settings;
    if (start <= end) {
      return now >= start && now < end;
    }
    return now >= start || now < end;
  }

  async pushLatestDigest(digestType: 'daily' | 'weekly' = 'daily'): Promise<{ success: boolean; message: string }> {
    const digest = await this.getLatestDigest(digestType);
    if (!digest) {
      return { success: false, message: `暂无${digestType === 'weekly' ? '周报' : '摘要'}可推送，请先生成` };
    }
    return this.pushDigestContent(digest.content, digest.articleCount, digestType);
  }

  async pushDigestContent(
    content: string,
    articleCount: number,
    digestType: 'daily' | 'weekly' = 'daily',
  ): Promise<{ success: boolean; message: string }> {
    const settings = await this.getSettings();
    const runId = await this.startRun('飞书卡片推送', `推送 ${articleCount} 篇情报摘要`);
    try {
      if (settings.feishuReceivers.length === 0 && !settings.groupWebhookUrl) {
        throw new Error('未配置飞书接收人或群机器人 Webhook，请先在设置页配置');
      }
      const title = `AI4S ${digestType === 'weekly' ? '每周情报周报' : '每日情报摘要'}（${articleCount} 篇）`;
      const pluginBody = renderFeishuMarkdownBudget(content, 4800);
      if (settings.feishuReceivers.length > 0) {
        await this.plugins.pushFeishuCard(title, pluginBody, settings.feishuReceivers);
      }
      if (settings.groupWebhookUrl) {
        const elements = buildFeishuCardElements(content);
        await this.pushGroupWebhook(settings.groupWebhookUrl, title, elements);
      }
      await this.finishRun(runId, 'success', 1, 1, 0, '推送成功');
      return { success: true, message: '推送成功' };
    } catch (error) {
      const reason = String(error).slice(0, 300);
      await this.finishRun(runId, 'failed', 1, 0, 1, reason);
      return { success: false, message: `推送失败：${reason}` };
    }
  }

  /** 群自定义机器人 Webhook：直接 POST 飞书卡片，绕开应用机器人入群限制 */
  private async pushGroupWebhook(
    webhookUrl: string,
    titleContent: string,
    elements: { tag: string; content?: string; text_align?: string; text_size?: string; color?: string }[],
  ): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: { template: 'blue', title: { tag: 'plain_text', content: titleContent } },
          elements,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null;
    if (!res.ok || !data || data.code !== 0) {
      throw new Error(`Webhook 推送失败：HTTP ${res.status}${data?.msg ? ` ${data.msg}` : ''}`);
    }
  }

  // ---------- 运行记录 ----------

  async startRun(taskType: string, detail: string): Promise<string> {
    const inserted = await this.db
      .insert(ai4sRun)
      .values({ taskType, status: 'running', detail, processed: 0, succeeded: 0, failed: 0 })
      .returning({ id: ai4sRun.id });
    return inserted[0].id;
  }

  async finishRun(
    id: string,
    status: 'success' | 'failed',
    processed: number,
    succeeded: number,
    failed: number,
    detailOrReason: string,
  ): Promise<void> {
    await this.db
      .update(ai4sRun)
      .set({
        status,
        processed,
        succeeded,
        failed,
        finishedAt: new Date(),
        ...(status === 'failed' ? { failureReason: detailOrReason } : { detail: detailOrReason }),
      })
      .where(eq(ai4sRun.id, id));
  }

  // ---------- 每日自动任务（由 daily_ai4s_digest 触发器调用） ----------

  async runDailyTask(): Promise<DailyTaskResult> {
    const settings = await this.getSettings();
    const result: DailyTaskResult = {
      sourcesTotal: 0,
      sourcesSucceeded: 0,
      sourcesFailed: 0,
      articlesInserted: 0,
      articlesAnalyzed: 0,
      articlesFailed: 0,
      digestGenerated: false,
      pushed: false,
      pushMessage: '',
      weeklyGenerated: false,
      weeklyPushMessage: '',
    };
    const runId = await this.startRun('每日自动监控', '抓取 → 去重 → AI 分析 → 每日摘要 → 飞书推送');
    try {
      let crawlSkipNote = '';
      if (settings.dailyCrawlEnabled && !this.inCrawlWindow(settings)) {
        crawlSkipNote = `当前 ${this.shanghaiHm()} 不在抓取窗口 ${settings.crawlWindowStart}–${settings.crawlWindowEnd} 内，本轮跳过抓取`;
        this.logger.log(crawlSkipNote);
      }
      if (settings.dailyCrawlEnabled && !crawlSkipNote) {
        const sources = (await this.db.select().from(ai4sSource)).filter((s) => s.enabled);
        result.sourcesTotal = sources.length;
        const analyzedBefore = await this.ingest.analyzedTodayCount();
        let analyzedCount = analyzedBefore;
        const budget = {
          remaining: () => Math.max(0, this.ingest.dailyAnalyzeLimit - analyzedCount),
        };
        const concurrency = Math.min(Math.max(settings.concurrency, 1), 8);
        for (let i = 0; i < sources.length; i += concurrency) {
          const batch = sources.slice(i, i + concurrency);
          const outcomes = await Promise.allSettled(
            batch.map(async (source) => {
              const stats = await this.ingest.ingestSource(source, {
                retryCount: settings.retryCount,
                timeoutMs: settings.timeoutSeconds * 1000,
                budget,
              });
              analyzedCount += stats.analyzed;
              return stats;
            }),
          );
          outcomes.forEach((outcome, idx) => {
            if (outcome.status === 'fulfilled') {
              result.sourcesSucceeded += 1;
              result.articlesInserted += outcome.value.inserted;
              result.articlesAnalyzed += outcome.value.analyzed;
              result.articlesFailed += outcome.value.failedArticles;
            } else {
              result.sourcesFailed += 1;
              void this.ingest.markSourceFailed(batch[idx], outcome.reason);
            }
          });
        }
      }

      if (settings.dailyPushEnabled) {
        const digest = await this.generateDailyDigest();
        result.digestGenerated = true;
        const push = await this.pushDigestContent(digest.content, digest.articleCount);
        result.pushed = push.success;
        result.pushMessage = push.message;
      }

      if (settings.weeklyReportEnabled && (await this.shouldGenerateWeekly(settings.weeklyReportDay))) {
        try {
          const weekly = await this.generateWeeklyDigest();
          result.weeklyGenerated = true;
          const weeklyPush = await this.pushDigestContent(weekly.content, weekly.articleCount, 'weekly');
          result.weeklyPushMessage = weeklyPush.message;
        } catch (error) {
          const reason = String(error).slice(0, 300);
          this.logger.error(`周报生成失败: ${reason}`);
          result.weeklyPushMessage = `周报生成失败：${reason}`;
        }
      }

      await this.db
        .update(ai4sSettings)
        .set({ lastRunAt: new Date() })
        .where(and(isNotNull(ai4sSettings.id)));
      await this.finishRun(
        runId,
        result.sourcesFailed > 0 && result.sourcesSucceeded === 0 ? 'failed' : 'success',
        result.sourcesTotal,
        result.sourcesSucceeded,
        result.sourcesFailed,
        `来源成功 ${result.sourcesSucceeded}/${result.sourcesTotal}，新增 ${result.articlesInserted} 篇，` +
          `分析成功 ${result.articlesAnalyzed} 篇${result.digestGenerated ? '，摘要已生成' : ''}` +
          `${result.pushed ? '，已推送飞书' : ''}${result.weeklyGenerated ? '，周报已生成' : ''}` +
          `${crawlSkipNote ? `；${crawlSkipNote}` : ''}`,
      );
      return result;
    } catch (error) {
      const reason = String(error).slice(0, 300);
      this.logger.error(`每日任务失败: ${reason}`);
      await this.finishRun(runId, 'failed', result.sourcesTotal, result.sourcesSucceeded, result.sourcesFailed + 1, reason);
      throw error;
    }
  }

  /** 服务端生成每日摘要（基于今日已分析文章，纯文本两板块：重点情报(评分=5) / 趋势观察） */
  async generateDailyDigest(): Promise<IAi4sDigest> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await this.db
      .select()
      .from(ai4sArticle)
      .where(and(gte(ai4sArticle.crawledAt, start), eq(ai4sArticle.analysisStatus, 'done')))
      .orderBy(desc(ai4sArticle.score))
      .limit(40);
    if (rows.length === 0) {
      throw new Error('今日暂无已分析情报，无法生成摘要');
    }
    const highRows = rows.filter((r) => r.score === 5);
    const lowRows = rows.filter((r) => r.score < 5);
    const highBriefs = this.buildArticleBriefs(highRows);
    const lowBriefs = lowRows.map((r) => `- [评分${r.score}] ${r.title}`).join('\n');
    const prompt =
      '你是 AI4S（AI for Science）领域首席情报分析师。请基于以下今日情报素材，整理生成「每日AI4S情报」，输出结构：\n' +
      '依次输出两个板块：【重点情报】（只从下方「高分情报素材」中选取，优先评分最高的，评分低于 5 分的不得进入该板块）、【趋势观察】（2-3 条基于当日全部情报的中文研判，每条一行，条目之间空一行，不要自行添加编号）。日报不输出【其他动态】板块；评分 <5 的情报一律直接丢弃，不得作为条目出现在日报任何位置。输出必须以【趋势观察】板块收尾；若高分情报素材为空，则【重点情报】板块整个不输出，仅输出【趋势观察】。\n' +
       '【重点情报】内部按六个分类依次组织：模型、数据、AI4S 应用、自动化实验室、产业与商业、其他。每个分类先单独一行输出「分类：模型」这样的分类行，再输出该分类下的情报；某分类没有情报时整个分类不输出，既不保留分类行也不写「暂无相关情报」。必须严格沿用素材中已标注的分类，不得自行重新归类；跨领域研究总览按素材给出的分类归位，严禁将已分到模型/数据/AI4S应用/自动化实验室/产业与商业的文章因内容多元而挪到「其他」。\n' +
      '每条情报严格按以下四行输出，「来源」「评分」「摘要」「原文链接」各占一行：\n' +
      '来源：来源名称\n评分：X/5\n摘要：一句话摘要（两句话以内，不添加未经原文证实的判断）\n原文链接：https://...\n' +
      '排版与整理要求：1. 必须纯文本输出，不使用 Markdown；不使用井号、星号、表格、代码块、加粗、斜体或 Markdown 项目符号。2. 所有文字使用统一的表达风格和字号，不要用特殊字符制造不同字号或视觉效果。3. 各个分类之间空两行；每条情报之间空一行。4. 不要把多条情报合并在同一段中。5. 板块内按评分从高到低排列；评分相同时，优先排列影响范围更广、信息密度更高的情报。6. 删除重复情报，保留信息最完整、原文链接最可靠的一条；同一主体、同一评分的多条情报必须合并成一条情报，合并后的摘要控制在三句话以内。7. 最终只输出整理后的正文，不要输出整理过程、分类理由或额外说明。\n\n' +
      '今日高分情报素材（评分 =5，【重点情报】条目仅可从这里选择）：\n' +
      highBriefs +
      '\n\n今日低分情报标题参考（仅供【趋势观察】归纳参考，不得输出为条目）：\n' +
      lowBriefs;
    const content = await this.plugins.generateText(prompt);
    return this.saveDigest(content, rows.length);
  }

  /** 服务端生成每周情报周报（基于近 7 天已分析文章，纯文本：重点情报 + 趋势观察） */
  async generateWeeklyDigest(): Promise<IAi4sDigest> {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select()
      .from(ai4sArticle)
      .where(and(gte(ai4sArticle.crawledAt, start), eq(ai4sArticle.analysisStatus, 'done')))
      .orderBy(desc(ai4sArticle.score))
      .limit(300);
    if (rows.length === 0) {
      throw new Error('近 7 天暂无已分析情报，无法生成周报');
    }
    const highRows = rows.filter((r) => r.score === 5);
    const lowRows = rows.filter((r) => r.score < 5);
    const highBriefs = this.buildArticleBriefs(highRows);
    const lowBriefs = lowRows.map((r) => `- [评分${r.score}] ${r.title}`).join('\n');
    const prompt =
      '你是 AI4S（AI for Science）领域首席情报分析师。请基于以下近 7 天情报素材，整理生成「每周AI4S情报」，输出结构：\n' +
      '依次输出两个板块：【重点情报】（只从下方「高分情报素材」中选取，最多 20 条，优先评分最高的，评分低于 5 分的不得进入该板块）、【趋势观察】（3-5 条基于本周全部情报跨来源归纳的中文研判，每条一行，条目之间空一行，不要自行添加编号）。周报不输出【其他动态】板块；评分 <5 的情报一律直接丢弃，不得出现在周报任何位置。输出必须以【趋势观察】板块收尾；若高分情报素材为空，则【重点情报】板块整个不输出，仅输出【趋势观察】。\n' +
       '【重点情报】内部按六个分类依次组织：模型、数据、AI4S 应用、自动化实验室、产业与商业、其他。每个分类先单独一行输出「分类：模型」这样的分类行，再输出该分类下的情报；某分类没有情报时整个分类不输出，既不保留分类行也不写「暂无相关情报」。必须严格沿用素材中已标注的分类，不得自行重新归类；跨领域研究总览按素材给出的分类归位，严禁将已分到模型/数据/AI4S应用/自动化实验室/产业与商业的文章因内容多元而挪到「其他」。\n' +
      '每条情报严格按以下四行输出，「来源」「评分」「摘要」「原文链接」各占一行：\n' +
      '来源：来源名称\n评分：X/5\n摘要：一句话摘要（两句话以内，不添加未经原文证实的判断）\n原文链接：https://...\n' +
      '排版与整理要求：1. 必须纯文本输出，不使用 Markdown；不使用井号、星号、表格、代码块、加粗、斜体或 Markdown 项目符号。2. 所有文字使用统一的表达风格和字号，不要用特殊字符制造不同字号或视觉效果。3. 各个分类之间空两行；每条情报之间空一行。4. 不要把多条情报合并在同一段中。5. 板块内按评分从高到低排列；评分相同时，优先排列影响范围更广、信息密度更高的情报。6. 删除重复情报，保留信息最完整、原文链接最可靠的一条；同一主体、同一评分的多条情报必须合并成一条情报，合并后的摘要控制在三句话以内。7. 最终只输出整理后的正文，不要输出整理过程、分类理由或额外说明。\n\n' +
      '本周高分情报素材（评分 =5，【重点情报】条目仅可从这里选择）：\n' +
      highBriefs +
      '\n\n本周低分情报标题参考（仅供【趋势观察】归纳参考，不得输出为条目）：\n' +
      lowBriefs;
    const content = await this.plugins.generateText(prompt);
    return this.saveDigest(content, rows.length, 'weekly');
  }

  private buildArticleBriefs(rows: ArticleRow[]): string {
    return rows
      .map(
        (r) =>
          `- [评分${r.score}][${r.category ?? '其他'}] ${r.title}（来源主体：${r.sourceName ?? '未知来源'}）：${(r.summary ?? '').slice(0, 120)}\n  原文链接：${r.url}`,
      )
      .join('\n');
  }

  /** 当前上海时间星期（mon~sun） */
  private shanghaiWeekday(): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
      .format(new Date())
      .toLowerCase();
  }

  /** 本周一 00:00（上海时间）对应的时刻 */
  private shanghaiWeekStart(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date());
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const idx: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const monday = new Date(`${map.year}-${map.month}-${map.day}T00:00:00+08:00`);
    monday.setDate(monday.getDate() - ((idx[map.weekday] ?? 1) - 1));
    return monday;
  }

  /** 是否应生成周报：今天是配置的周报日，且本周尚未生成过 */
  private async shouldGenerateWeekly(weeklyReportDay: string): Promise<boolean> {
    if (this.shanghaiWeekday() !== weeklyReportDay) {
      return false;
    }
    const latest = await this.db
      .select({ generatedAt: ai4sDigest.generatedAt })
      .from(ai4sDigest)
      .where(eq(ai4sDigest.digestType, 'weekly'))
      .orderBy(desc(ai4sDigest.generatedAt))
      .limit(1);
    if (latest.length > 0 && latest[0].generatedAt >= this.shanghaiWeekStart()) {
      return false;
    }
    return true;
  }
}

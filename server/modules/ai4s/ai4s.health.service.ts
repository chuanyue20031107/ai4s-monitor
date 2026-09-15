/**
 * AI4S 情报雷达 — 来源健康检查编排服务
 * testSource（单来源测试）/ startHealthCheck（后台全量检查）/ getHealthCheckStats（聚合统计）
 * 具体单来源探测逻辑见 ai4s.health.checker.ts
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { ai4sRun, ai4sSettings, ai4sSource } from '@server/database/schema';
import type {
  Ai4sCrawlStatus,
  Ai4sRunStatus,
  IAi4sHealthCheckStartResponse,
  IAi4sHealthCheckStats,
  IAi4sHealthCheckTypeCount,
  IAi4sSourceCheckItem,
} from '@shared/api.interface';
import { normalizeUrl } from './ai4s.strategy';
import { Ai4sHealthChecker, type CheckContext } from './ai4s.health.checker';

type SourceRow = typeof ai4sSource.$inferSelect;

const DEFAULT_TIMEOUT_SECONDS = 30;

@Injectable()
export class Ai4sHealthService {
  private readonly logger = new Logger(Ai4sHealthService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly checker: Ai4sHealthChecker,
  ) {}

  /** 单来源测试（超时秒数取自 settings） */
  async testSource(source: SourceRow): Promise<IAi4sSourceCheckItem> {
    const rows = await this.db
      .select({ timeoutSeconds: ai4sSettings.timeoutSeconds })
      .from(ai4sSettings)
      .limit(1);
    const timeoutMs = (rows[0]?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    return this.checker.checkSource(source, { timeoutMs });
  }

  /** 启动全量健康检查：立即返回 runId/total，后台按并发分批执行 */
  async startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
    const settingRows = await this.db.select().from(ai4sSettings).limit(1);
    const concurrency = Math.min(Math.max(settingRows[0]?.concurrency ?? 4, 1), 8);
    const timeoutMs = (settingRows[0]?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const sources = (await this.db.select().from(ai4sSource)).filter((s: SourceRow) => s.enabled);
    const inserted = await this.db
      .insert(ai4sRun)
      .values({
        taskType: '全量健康检查',
        status: 'running',
        detail: `并发 ${concurrency}，超时 ${timeoutMs / 1000}s`,
        processed: 0,
        succeeded: 0,
        failed: 0,
      })
      .returning({ id: ai4sRun.id });
    const runId = inserted[0].id;
    void this.runHealthCheck(runId, sources, { timeoutMs, shared: this.buildSharedMap(sources) }, concurrency);
    return { runId, total: sources.length };
  }

  /** 健康检查聚合统计（含最近一次 run 状态） */
  async getHealthCheckStats(): Promise<IAi4sHealthCheckStats> {
    const rows = await this.db
      .select({ crawlStatus: ai4sSource.crawlStatus, lastCheckAt: ai4sSource.lastCheckAt })
      .from(ai4sSource)
      .where(isNotNull(ai4sSource.lastCheckAt));
    let ok = 0;
    let noContent = 0;
    let lastCheck: Date | null = null;
    const failureCounts = new Map<Ai4sCrawlStatus, number>();
    for (const row of rows) {
      const status = row.crawlStatus as Ai4sCrawlStatus;
      if (status === 'ok') {
        ok += 1;
      } else if (status === 'no_content') {
        noContent += 1;
      } else if (status !== 'idle') {
        failureCounts.set(status, (failureCounts.get(status) ?? 0) + 1);
      }
      if (row.lastCheckAt && (!lastCheck || row.lastCheckAt > lastCheck)) {
        lastCheck = row.lastCheckAt;
      }
    }
    const failureByType: IAi4sHealthCheckTypeCount[] = [...failureCounts.entries()].map(
      ([type, count]: [Ai4sCrawlStatus, number]) => ({ type, count }),
    );
    const runRows = await this.db
      .select()
      .from(ai4sRun)
      .where(eq(ai4sRun.taskType, '全量健康检查'))
      .orderBy(desc(ai4sRun.startedAt))
      .limit(1);
    const run = runRows[0] ?? null;
    return {
      runId: run?.id ?? null,
      status: (run?.status as Ai4sRunStatus | undefined) ?? null,
      running: run?.status === 'running',
      total: rows.length,
      ok,
      noContent,
      failed: rows.length - ok - noContent,
      failureByType,
      lastCheckAt: lastCheck ? lastCheck.toISOString() : null,
    };
  }

  // ---------- 内部实现 ----------

  /** 预计算地址共享情况：normalizedUrl → 使用该地址的 sourceKey 列表 */
  private buildSharedMap(sources: SourceRow[]): Map<string, string[]> {
    const shared = new Map<string, string[]>();
    for (const s of sources) {
      for (const raw of [s.feedUrl ?? '', s.discoveredFeedUrl ?? '', s.website ?? '']) {
        if (!raw) continue;
        const norm = normalizeUrl(raw);
        if (!norm) continue;
        shared.set(norm, [...(shared.get(norm) ?? []), s.sourceKey]);
      }
    }
    return shared;
  }

  /** 后台执行全量检查并收尾 run 记录 */
  private async runHealthCheck(
    runId: string,
    sources: SourceRow[],
    ctx: CheckContext,
    concurrency: number,
  ): Promise<void> {
    const counts = new Map<Ai4sCrawlStatus, number>();
    try {
      for (let i = 0; i < sources.length; i += concurrency) {
        const batch = sources.slice(i, i + concurrency);
        await Promise.allSettled(
          batch.map(async (s: SourceRow) => {
            const item = await this.checker.checkSource(s, ctx);
            counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
          }),
        );
      }
      const ok = counts.get('ok') ?? 0;
      const noContent = counts.get('no_content') ?? 0;
      const succeeded = ok + noContent;
      const failed = sources.length - succeeded;
      const labelMap: Array<[Ai4sCrawlStatus, string]> = [
        ['timeout', '超时'],
        ['network_error', '网络错误'],
        ['robots_blocked', 'robots'],
        ['invalid_url', '地址无效'],
        ['parse_failed', '解析失败'],
        ['needs_config', '需配置'],
        ['failed', '其他'],
      ];
      const parts: string[] = [];
      for (const [status, label] of labelMap) {
        const count = counts.get(status) ?? 0;
        if (count > 0) parts.push(`${label} ${count}`);
      }
      const detail =
        `成功 ${ok} · 无新内容 ${noContent} · 失败 ${failed}` +
        (parts.length > 0 ? `（${parts.join(' / ')}）` : '');
      await this.db
        .update(ai4sRun)
        .set({
          status: succeeded > 0 ? 'success' : 'failed',
          processed: sources.length,
          succeeded,
          failed,
          finishedAt: new Date(),
          detail,
        })
        .where(eq(ai4sRun.id, runId));
    } catch (error) {
      const reason = String(error).slice(0, 300);
      this.logger.error(`健康检查任务失败: ${reason}`);
      await this.db
        .update(ai4sRun)
        .set({ status: 'failed', processed: sources.length, finishedAt: new Date(), failureReason: reason })
        .where(eq(ai4sRun.id, runId));
    }
  }
}

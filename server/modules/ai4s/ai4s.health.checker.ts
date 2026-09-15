/**
 * AI4S 情报雷达 — 单来源健康检查器
 * 验证地址可达性与抓取通道（RSS/Sitemap/entry/crawler），
 * 不调用 AI 分析、不写 ai4s_article；含数据修复（无效地址清空/协议补全/发现 feed 落库）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { ai4sSource } from '@server/database/schema';
import type {
  Ai4sCrawlStatus,
  Ai4sCrawlStrategy,
  Ai4sResolvedStrategy,
  IAi4sSourceCheckItem,
} from '@shared/api.interface';
import { looksLikeFeedXml, parseFeed } from './ai4s.feed-parser';
import {
  discoverFeedLink,
  FEED_PROBE_PATHS,
  isAllowedByRobots,
  isConferenceType,
  normalizeUrl,
  suggestionForStatus,
} from './ai4s.strategy';

type SourceRow = typeof ai4sSource.$inferSelect;

const HEALTH_UA = 'AI4S-Radar/1.0';

export interface CheckContext {
  timeoutMs: number;
  shared?: Map<string, string[]>;
}

@Injectable()
export class Ai4sHealthChecker {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private async fetchText(
    url: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; url: string; body: string }> {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': HEALTH_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status, url: res.url, body: await res.text() };
  }

  /** 写回 source 行并返回检查项 */
  private async persist(
    source: SourceRow,
    ctx: CheckContext,
    startedAt: number,
    o: {
      status: Ai4sCrawlStatus;
      reason: string;
      suggestion: string;
      articlesFound?: number;
      resolved?: Ai4sResolvedStrategy;
      url?: string;
      discovered?: string;
    },
  ): Promise<IAi4sSourceCheckItem> {
    let reason = o.reason;
    if (ctx.shared && o.url) {
      const others = (ctx.shared.get(o.url) ?? []).filter((k: string) => k !== source.sourceKey);
      if (others.length > 0) {
        reason = `${reason}（与 ${others.join('、')} 共用同一地址）`;
      }
    }
    const patch: Partial<typeof ai4sSource.$inferInsert> = {
      crawlStatus: o.status,
      lastCheckAt: new Date(),
      lastDiagnostic: `${o.status}｜${reason}｜建议：${o.suggestion}`,
    };
    if (o.discovered !== undefined) patch.discoveredFeedUrl = o.discovered;
    if (o.status === 'ok' || o.status === 'no_content') patch.lastSuccessAt = new Date();
    await this.db.update(ai4sSource).set(patch).where(eq(ai4sSource.id, source.id));
    return {
      sourceKey: source.sourceKey,
      name: source.name,
      strategy: (source.crawlStrategy ?? 'auto') as Ai4sCrawlStrategy,
      resolvedStrategy: o.resolved ?? 'none',
      url: o.url ?? '',
      status: o.status,
      reason,
      suggestion: o.suggestion,
      articlesFound: o.articlesFound ?? 0,
      durationMs: Date.now() - startedAt,
    };
  }

  /** 单来源检查主流程 */
  async checkSource(source: SourceRow, ctx: CheckContext): Promise<IAi4sSourceCheckItem> {
    const t0 = Date.now();
    const strategy = (source.crawlStrategy ?? 'auto') as Ai4sCrawlStrategy;

    if (strategy === 'disabled') {
      return this.persist(source, ctx, t0, {
        status: 'needs_config',
        reason: '策略已标记为不可抓取',
        suggestion: '策略已标记为不可抓取，请人工补充有效 RSS/官网地址',
        url: source.feedUrl ?? '',
      });
    }

    const rawFeed = (source.feedUrl ?? '').trim();
    let feedUrl: string | null = null;
    let protocolNote = '';
    if (rawFeed) {
      feedUrl = normalizeUrl(rawFeed);
      if (!feedUrl) {
        await this.db.update(ai4sSource).set({ feedUrl: '' }).where(eq(ai4sSource.id, source.id));
        return this.persist(source, ctx, t0, {
          status: 'invalid_url',
          reason: '原地址不是有效 URL，已清空',
          suggestion: '请补充有效的 RSS 或官网地址',
          url: rawFeed,
        });
      }
      if (!/^https?:\/\//i.test(rawFeed)) {
        await this.db.update(ai4sSource).set({ feedUrl }).where(eq(ai4sSource.id, source.id));
        protocolNote = '已自动补全协议';
      }
    }
    const websiteUrl = source.website ? normalizeUrl(source.website) : null;
    if (!feedUrl && !websiteUrl) {
      return this.persist(source, ctx, t0, {
        status: 'invalid_url',
        reason: '该来源无可用地址，需人工配置',
        suggestion: '请补充 RSS 或官网地址',
      });
    }
    const candidate = feedUrl ?? websiteUrl ?? '';
    const fail = (status: Ai4sCrawlStatus, reason: string, url: string = candidate) =>
      this.persist(source, ctx, t0, { status, reason, suggestion: suggestionForStatus(status), url });
    const okItem = (
      reason: string,
      o: { found?: number; resolved: Ai4sResolvedStrategy; url?: string; discovered?: string },
    ) =>
      this.persist(source, ctx, t0, {
        status: 'ok',
        reason,
        suggestion: suggestionForStatus('ok'),
        articlesFound: o.found,
        resolved: o.resolved,
        url: o.url ?? candidate,
        discovered: o.discovered,
      });

    try {
      const robots = await isAllowedByRobots(candidate, ctx.timeoutMs);
      if (!robots.allowed) {
        return fail('robots_blocked', robots.reason);
      }
      const res = await this.fetchText(candidate, ctx.timeoutMs);
      const notes: string[] = [];
      if (protocolNote) notes.push(protocolNote);
      if (res.url !== candidate) notes.push(`重定向至 ${res.url}`);
      const note = notes.length > 0 ? `（${notes.join('，')}）` : '';

      if (res.status === 401 || res.status === 403) {
        return fail('needs_config', `HTTP ${res.status}，需要登录或存在反爬限制${note}`);
      }
      if (res.status === 404 || res.status === 410) {
        // feed 地址已失效但配置了官网 → 回退官网重新检测（官网 crawler 兜底原则）
        if (feedUrl && websiteUrl && websiteUrl !== feedUrl && strategy === 'auto') {
          const item = await this.checkSource({ ...source, feedUrl: '' }, ctx);
          if (item.status === 'ok' || item.status === 'no_content') {
            const note = `原 feed 地址 HTTP ${res.status} 已失效，已回退官网检测；`;
            const diagnostic = `${item.status}｜${note}${item.reason}｜建议：${item.suggestion}`;
            await this.db
              .update(ai4sSource)
              .set({ lastDiagnostic: diagnostic })
              .where(eq(ai4sSource.id, source.id));
            return { ...item, reason: note + item.reason };
          }
          return item;
        }
        return fail('invalid_url', `HTTP ${res.status}，地址不存在${note}`);
      }
      if (!res.ok) {
        return fail('network_error', `HTTP ${res.status}，服务端异常${note}`);
      }

      if (looksLikeFeedXml(res.body)) {
        const isSitemap = res.body.slice(0, 1000).toLowerCase().includes('<urlset');
        const items = parseFeed(res.body);
        if (items.length > 0) {
          return okItem(
            `${isSitemap ? 'Sitemap 解析成功' : 'RSS/Atom 解析成功'}，含 ${items.length} 条条目${note}`,
            {
              found: items.length,
              resolved: isSitemap ? 'sitemap' : 'rss',
              discovered: source.discoveredFeedUrl === candidate ? undefined : candidate,
            },
          );
        }
        return fail('parse_failed', `XML 无可解析条目${note}`);
      }

      // HTML 页面：先从 head 自动发现 RSS
      const feedLink = discoverFeedLink(res.body, res.url);
      if (feedLink) {
        const feedRobots = await isAllowedByRobots(feedLink, ctx.timeoutMs);
        if (!feedRobots.allowed) {
          return fail('robots_blocked', `页面发现的 feed 被 robots 禁止：${feedRobots.reason}`, feedLink);
        }
        try {
          const feedRes = await this.fetchText(feedLink, ctx.timeoutMs);
          if (feedRes.ok && looksLikeFeedXml(feedRes.body)) {
            const items = parseFeed(feedRes.body);
            if (items.length > 0) {
              return okItem(`从页面 head 自动发现 RSS，含 ${items.length} 条条目${note}`, {
                found: items.length,
                resolved: 'rss',
                url: feedLink,
                discovered: feedLink,
              });
            }
          }
        } catch {
          // 发现的 feed 抓取失败，继续探测常见路径
        }
      }

      // 依次探测常见 feed 路径（每条先过 robots 检查）
      const origin = new URL(res.url).origin;
      for (const path of FEED_PROBE_PATHS) {
        const probeUrl = `${origin}${path}`;
        if (!(await isAllowedByRobots(probeUrl, ctx.timeoutMs)).allowed) continue;
        try {
          const probeRes = await this.fetchText(probeUrl, ctx.timeoutMs);
          if (!probeRes.ok || !looksLikeFeedXml(probeRes.body)) continue;
          const isSitemap = probeRes.body.slice(0, 1000).toLowerCase().includes('<urlset');
          const items = parseFeed(probeRes.body);
          if (items.length === 0) continue;
          return okItem(
            isSitemap
              ? `自动发现 Sitemap，含 ${items.length} 条条目`
              : `自动探测 RSS 路径成功，含 ${items.length} 条条目`,
            { found: items.length, resolved: isSitemap ? 'sitemap' : 'rss', url: probeUrl, discovered: probeUrl },
          );
        } catch {
          // 该路径探测失败，继续下一条
        }
      }

      // 页面本身可达：会议/活动走 entry，其余走 crawler
      if (res.body.length > 500) {
        if (isConferenceType(source.type ?? '')) {
          return okItem(`会议/活动列表入口可达${note}`, { resolved: 'entry' });
        }
        return okItem(`页面可达，将由 crawler 插件抓取正文${note}`, { resolved: 'crawler' });
      }
      return fail('parse_failed', `页面内容过少（${res.body.length} 字符），无法判定抓取通道`);
    } catch (error) {
      const text = String(error);
      const status: Ai4sCrawlStatus = /TimeoutError|AbortError|aborted/i.test(text)
        ? 'timeout'
        : 'network_error';
      return fail(status, `${status === 'timeout' ? '请求超时' : '站点无法访问'}：${text.slice(0, 120)}`);
    }
  }
}

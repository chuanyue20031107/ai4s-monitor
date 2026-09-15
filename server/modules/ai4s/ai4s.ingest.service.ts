/**
 * AI4S 情报雷达 — 抓取入库链路（服务端）
 * 策略解析（auto: RSS > Sitemap/发现 feed > crawler 插件兜底）→ 超时/重试/退避 fetch
 *   → URL 去重 → AI 结构化分析 → 入库
 * 失败隔离：单来源/单篇失败只记录细分状态，不中断其他来源
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { ai4sArticle, ai4sSource } from '@server/database/schema';
import type { Ai4sCrawlStatus, Ai4sCrawlStrategy, IAi4sRecategorizeResult } from '@shared/api.interface';
import { Ai4sPluginService } from './ai4s.plugins';
import {
  extractMarkdownTitle,
  htmlToPlainText,
  isSitemapXml,
  looksLikeFeedXml,
  parseFeed,
  type FeedItem,
} from './ai4s.feed-parser';
import {
  classifyCrawlError,
  isAllowedByRobots,
  normalizeUrl,
  suggestionForStatus,
} from './ai4s.strategy';
import { extractArticleLinks, isArticleLikeLink, type PageLink } from './ai4s.link-extract';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ITEMS_PER_SOURCE = 5;
const SITEMAP_SCAN_LIMIT = 100;
const DAILY_ANALYZE_LIMIT = 300;

type SourceRow = typeof ai4sSource.$inferSelect;

export interface IngestStats {
  inserted: number;
  skipped: number;
  analyzed: number;
  failedArticles: number;
}

export interface IngestOutcome extends IngestStats {
  success: boolean;
  message: string;
}

export interface AnalyzeBudget {
  remaining: () => number;
}

export interface IngestOptions {
  retryCount: number;
  timeoutMs: number;
  budget?: AnalyzeBudget;
}

export interface ArticleAnalysis {
  category: string;
  score: number;
  importanceReason: string;
  contentType: string;
  moatTags: string[];
  summary: string;
}

@Injectable()
export class Ai4sIngestService {
  private readonly logger = new Logger(Ai4sIngestService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly plugins: Ai4sPluginService,
  ) {}

  /** 服务端直接 fetch（AbortSignal 超时 + UA 头） */
  private async fetchUrl(url: string, timeoutMs: number): Promise<string> {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  }

  /** 带重试与指数退避的 fetch（最多重试 retryCount 次，退避上限 8s） */
  private async fetchWithRetry(
    url: string,
    opts: { retryCount: number; timeoutMs: number },
  ): Promise<string> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= opts.retryCount; attempt += 1) {
      try {
        return await this.fetchUrl(url, opts.timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt < opts.retryCount) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
        }
      }
    }
    throw lastError;
  }

  /** 解析 feed XML 中可入库的条目（有标题且是 http(s) 链接；sitemap 相对 loc 补全为绝对地址） */
  private validFeedItems(xml: string, feedOriginUrl?: string, limit = MAX_ITEMS_PER_SOURCE): FeedItem[] {
    return parseFeed(xml)
      .map((i: FeedItem): FeedItem => {
        if (/^https?:\/\//.test(i.url) || !feedOriginUrl) return i;
        try {
          return { ...i, url: new URL(i.url, feedOriginUrl).href };
        } catch {
          return i;
        }
      })
      .filter((i: FeedItem) => i.title && /^https?:\/\//.test(i.url))
      .slice(0, limit);
  }

  /** sitemap 条目选取：优先文章页、过滤已入库 URL，取前 N 条待补抓（避免每次都取前几条静态页） */
  private async pickSitemapCandidates(items: FeedItem[]): Promise<FeedItem[]> {
    const articleLike = items.filter((i: FeedItem) => isArticleLikeLink(i.url));
    const pool = articleLike.length > 0 ? articleLike : items;
    const known = await this.selectKnownUrls(pool.map((i: FeedItem) => i.url));
    return pool.filter((i: FeedItem) => !known.has(i.url)).slice(0, MAX_ITEMS_PER_SOURCE);
  }

  /** Sitemap 条目无标题/正文 → 抓取页面补齐（失败则保留原样，不阻断） */
  private async enrichSitemapItems(items: FeedItem[], opts: IngestOptions): Promise<FeedItem[]> {
    return Promise.all(
      items.map(async (item: FeedItem): Promise<FeedItem> => {
        try {
          const robots = await isAllowedByRobots(item.url, opts.timeoutMs);
          if (!robots.allowed) return item;
          const html = await this.fetchUrl(item.url, opts.timeoutMs);
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const pageTitle = titleMatch
            ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 150)
            : '';
          const text = htmlToPlainText(html);
          return {
            ...item,
            title: pageTitle && !/^https?:\/\//.test(pageTitle) ? pageTitle : item.title,
            content: text.slice(0, 6000),
          };
        } catch (error) {
          this.logger.warn(
            `sitemap 条目正文补抓失败 ${item.url}: ${String(error).slice(0, 120)}`,
          );
          return item;
        }
      }),
    );
  }

  /** 查询候选链接中已入库的 URL 集合（避免重复抓取正文与分析） */
  private async selectKnownUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const rows = await this.db
      .select({ url: ai4sArticle.url })
      .from(ai4sArticle)
      .where(inArray(ai4sArticle.url, urls));
    return new Set(rows.map((r: { url: string }) => r.url));
  }

  /** 解析页面站内文章链接并逐条补抓正文；解析不出链接时返回 null 走原 crawler 兜底 */
  private async collectPageLinkItems(
    target: string,
    opts: IngestOptions,
  ): Promise<FeedItem[] | null> {
    const robots = await isAllowedByRobots(target, opts.timeoutMs);
    if (!robots.allowed) return null;
    let html: string;
    try {
      html = await this.fetchUrl(target, opts.timeoutMs);
    } catch (error) {
      this.logger.warn(
        `页面链接提取失败，转 crawler 兜底 ${target}：${String(error).slice(0, 120)}`,
      );
      return null;
    }
    const candidates: PageLink[] = extractArticleLinks(html, target);
    if (candidates.length === 0) return null;
    const known = await this.selectKnownUrls(candidates.map((c: PageLink) => c.url));
    const unknown = candidates.filter((c: PageLink) => !known.has(c.url));
    if (unknown.length === 0) {
      // 全部已入库：返回已知链接让去重计数，来源状态保持 ok
      return candidates.slice(0, MAX_ITEMS_PER_SOURCE).map((c: PageLink): FeedItem => ({
        title: c.title,
        url: c.url,
        publishedAt: null,
        content: '',
      }));
    }
    return this.enrichSitemapItems(
      unknown.slice(0, MAX_ITEMS_PER_SOURCE).map((c: PageLink): FeedItem => ({
        title: c.title,
        url: c.url,
        publishedAt: null,
        content: '',
      })),
      opts,
    );
  }

  /** 按策略抓取来源条目；noContent=true 表示 feed 抓取成功但解析到 0 条 */
  private async fetchSourceItems(
    source: SourceRow,
    opts: IngestOptions,
  ): Promise<{ items: FeedItem[]; noContent: boolean }> {
    const strategy = (source.crawlStrategy ?? 'auto') as Ai4sCrawlStrategy;
    const feedUrl = source.feedUrl ? normalizeUrl(source.feedUrl) : null;
    const discoveredUrl = source.discoveredFeedUrl ? normalizeUrl(source.discoveredFeedUrl) : null;
    const wantsFeed = strategy === 'auto' || strategy === 'rss' || strategy === 'sitemap';

    if (wantsFeed) {
      // 显式 rss/sitemap 无 feed_url 时尝试 discovered feed 作为主地址
      const primary = feedUrl ?? (strategy === 'auto' ? null : discoveredUrl);
      if (primary) {
        const robots = await isAllowedByRobots(primary, opts.timeoutMs);
        if (!robots.allowed) {
          throw new Error(`robots_blocked: robots.txt 禁止抓取 ${primary}`);
        }
        let xml: string | null = null;
        try {
          xml = await this.fetchWithRetry(primary, opts);
        } catch (error) {
          if (strategy !== 'auto') throw error;
        }
        if (xml !== null && looksLikeFeedXml(xml)) {
          let items = this.validFeedItems(
            xml,
            primary,
            isSitemapXml(xml) ? SITEMAP_SCAN_LIMIT : MAX_ITEMS_PER_SOURCE,
          );
          if (isSitemapXml(xml)) {
            items = (await this.enrichSitemapItems(
              await this.pickSitemapCandidates(items),
              opts,
            )).filter((i: FeedItem) => i.content.length > 0);
          }
          if (items.length > 0) return { items, noContent: false };
          if (strategy !== 'auto') return { items: [], noContent: true };
        }
        // auto：主地址是 HTML 页面 → 尝试 discovered feed
        if (xml !== null && !looksLikeFeedXml(xml) && discoveredUrl) {
          const discoveredRobots = await isAllowedByRobots(discoveredUrl, opts.timeoutMs);
          if (discoveredRobots.allowed) {
            try {
              const discoveredXml = await this.fetchWithRetry(discoveredUrl, opts);
              if (looksLikeFeedXml(discoveredXml)) {
                let items = this.validFeedItems(
                  discoveredXml,
                  discoveredUrl,
                  isSitemapXml(discoveredXml) ? SITEMAP_SCAN_LIMIT : MAX_ITEMS_PER_SOURCE,
                );
                if (isSitemapXml(discoveredXml)) {
                  items = (await this.enrichSitemapItems(
                    await this.pickSitemapCandidates(items),
                    opts,
                  )).filter((i: FeedItem) => i.content.length > 0);
                }
                if (items.length > 0) return { items, noContent: false };
              }
            } catch (error) {
              this.logger.warn(
                `discovered feed 抓取失败，转 crawler 兜底 ${source.name}: ${String(error).slice(0, 120)}`,
              );
            }
          }
        }
      }
    }

    // crawler 插件兜底（auto / 会议列表入口 entry / crawler）；feed 地址失败时回退官网
    if (strategy === 'auto' || strategy === 'entry' || strategy === 'crawler') {
      const websiteUrl = source.website ? normalizeUrl(source.website) : null;
      const target = feedUrl ?? websiteUrl;
      if (!target) {
        throw new Error('来源未配置抓取地址');
      }
      // 先尝试解析页面站内文章链接逐条入库（静态官网页场景）
      const linkItems = await this.collectPageLinkItems(target, opts);
      if (linkItems !== null && linkItems.length > 0) {
        return { items: linkItems, noContent: false };
      }
      let markdown = '';
      let crawledUrl = target;
      try {
        markdown = await this.plugins.crawlPage(target);
      } catch (error) {
        if (feedUrl && websiteUrl && websiteUrl !== feedUrl) {
          this.logger.warn(
            `crawler 兜底失败 ${target}，回退官网 ${websiteUrl}：${String(error).slice(0, 120)}`,
          );
          markdown = await this.plugins.crawlPage(websiteUrl);
          crawledUrl = websiteUrl;
        } else {
          throw error;
        }
      }
      return {
        items: [
          {
            title: extractMarkdownTitle(markdown, source.name),
            url: crawledUrl,
            publishedAt: null,
            content: markdown,
          },
        ],
        noContent: false,
      };
    }

    throw new Error(`invalid_url: 策略为 ${strategy} 但未配置可用 feed 地址`);
  }

  /** AI 结构化分析单篇 */
  async analyzeContent(title: string, content: string): Promise<ArticleAnalysis> {
    const out = await this.plugins.analyzeArticle(title, content);
    // 插件 schema 当前将 moat_tags 声明为逗号分隔字符串，历史版本也可能返回数组；
    // 统一归一化后再写入 JSONB，避免分析成功但标签静默丢失。
    const rawMoatTags = out.moat_tags as unknown;
    const moatTags = Array.isArray(rawMoatTags)
      ? rawMoatTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawMoatTags === 'string'
        ? rawMoatTags
            .split(/[,，、]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    return {
      category: out.category ?? '其他',
      score: Number(out.importance_score ?? 0) || 0,
      importanceReason: out.importance_reason ?? '',
      contentType: out.content_type ?? '',
      moatTags,
      summary: out.chinese_summary ?? '',
    };
  }

  private isDiscardable(analysis: ArticleAnalysis): boolean {
    return analysis.category === '其他' && analysis.score <= 1;
  }

  /** 单篇入库并分析（URL 去重，原子冲突保护） */
  private async ingestItem(
    item: FeedItem,
    source: SourceRow | null,
    sourceMeta: { key: string; name: string; type: string },
    budget?: AnalyzeBudget,
  ): Promise<'inserted' | 'skipped' | 'failed'> {
    const now = new Date();
    const inserted = await this.db
      .insert(ai4sArticle)
      .values({
        title: item.title,
        sourceKey: sourceMeta.key,
        sourceName: sourceMeta.name,
        sourceType: sourceMeta.type,
        url: item.url,
        crawledAt: now,
        publishedAt: item.publishedAt ?? now,
        analysisStatus: 'pending',
        moatTags: [],
      })
      .onConflictDoNothing({ target: ai4sArticle.url })
      .returning({ id: ai4sArticle.id });
    if (inserted.length === 0) {
      return 'skipped';
    }
    const articleId = inserted[0].id;
    if (budget && budget.remaining() <= 0) {
      await this.db
        .update(ai4sArticle)
        .set({ analysisStatus: 'pending', failureReason: '超出当日分析上限，等待下轮任务分析' })
        .where(eq(ai4sArticle.id, articleId));
      return 'inserted';
    }
    await this.db.update(ai4sArticle).set({ analysisStatus: 'analyzing' }).where(eq(ai4sArticle.id, articleId));
    try {
      const analysis = await this.analyzeContent(item.title, item.content || item.title);
      const discard = this.isDiscardable(analysis) || analysis.score <= 0;
      await this.db
        .update(ai4sArticle)
        .set({
          analysisStatus: discard ? 'discarded' : 'done',
          category: analysis.category,
          score: analysis.score,
          importanceReason: analysis.importanceReason,
          contentType: analysis.contentType,
          moatTags: analysis.moatTags,
          summary: analysis.summary,
          failureReason: discard
            ? analysis.score <= 0
              ? '零分内容（非情报，多为导航页/介绍页/无实质动态），已自动剔出'
              : '低价值内容（评分≤1且无法归类，多为抓取残渣或导航页），已自动丢弃'
            : '',
        })
        .where(eq(ai4sArticle.id, articleId));
    } catch (error) {
      const reason = String(error).slice(0, 500);
      this.logger.warn(`AI 分析失败 ${item.url}: ${reason}`);
      await this.db
        .update(ai4sArticle)
        .set({ analysisStatus: 'failed', failureReason: reason })
        .where(eq(ai4sArticle.id, articleId));
      return 'failed';
    }
    return 'inserted';
  }

  /** 抓取单个来源并分析入库（带超时/重试与失败隔离） */
  async ingestSource(source: SourceRow, opts: IngestOptions): Promise<IngestStats> {
    const strategy = (source.crawlStrategy ?? 'auto') as Ai4sCrawlStrategy;
    if (strategy === 'disabled') {
      await this.db
        .update(ai4sSource)
        .set({
          crawlStatus: 'needs_config',
          lastCrawlAt: new Date(),
          lastError: '策略已标记为不可抓取（disabled）',
          lastDiagnostic: 'needs_config｜策略已标记为不可抓取｜建议：请人工补充有效 RSS 或官网地址',
        })
        .where(eq(ai4sSource.id, source.id));
      throw new Error('策略已标记为不可抓取（disabled），请人工补充有效 RSS 或官网地址');
    }
    const { items, noContent } = await this.fetchSourceItems(source, opts);
    if (items.length === 0) {
      if (!noContent) {
        throw new Error('未抓取到任何条目');
      }
      // 解析成功但 0 条目：不算失败
      await this.db
        .update(ai4sSource)
        .set({
          crawlStatus: 'no_content',
          lastCrawlAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: '',
          lastDiagnostic: 'no_content｜解析到 0 条条目｜建议：属正常现象，稍后自动重试',
        })
        .where(eq(ai4sSource.id, source.id));
      return { inserted: 0, skipped: 0, analyzed: 0, failedArticles: 0 };
    }
    const stats: IngestStats = { inserted: 0, skipped: 0, analyzed: 0, failedArticles: 0 };
    for (const item of items) {
      const result = await this.ingestItem(
        item,
        source,
        { key: source.sourceKey, name: source.name, type: source.type ?? '' },
        opts.budget,
      );
      if (result === 'skipped') {
        stats.skipped += 1;
      } else {
        stats.inserted += 1;
        if (result === 'failed') {
          stats.failedArticles += 1;
        } else {
          stats.analyzed += 1;
        }
      }
    }
    await this.db
      .update(ai4sSource)
      .set({
        crawlStatus: 'ok',
        lastCrawlAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: '',
        lastDiagnostic: `ok｜新增 ${stats.inserted} 篇，跳过重复 ${stats.skipped} 篇｜建议：抓取链路正常`,
      })
      .where(eq(ai4sSource.id, source.id));
    return stats;
  }

  /** 标记来源失败状态（细分 9 种状态，不中断其他来源） */
  async markSourceFailed(source: SourceRow, error: unknown, status?: Ai4sCrawlStatus): Promise<void> {
    const finalStatus = status ?? classifyCrawlError(error);
    await this.db
      .update(ai4sSource)
      .set({
        crawlStatus: finalStatus,
        lastCrawlAt: new Date(),
        lastError: String(error).slice(0, 500),
        lastDiagnostic: `${finalStatus}｜${String(error).slice(0, 200)}｜建议：${suggestionForStatus(finalStatus)}`,
      })
      .where(eq(ai4sSource.id, source.id));
  }

  /** 手动提交 URL：按域名匹配来源后走完整链路 */
  async ingestManualUrl(url: string): Promise<IngestOutcome> {
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      throw new Error('URL 格式不正确');
    }
    const sources = await this.db.select().from(ai4sSource);
    const source =
      sources.find((s) => {
        if (!s.website) return false;
        try {
          return new URL(s.website).hostname.replace(/^www\./, '') === host;
        } catch {
          return false;
        }
      }) ?? null;
    const meta = source
      ? { key: source.sourceKey, name: source.name, type: source.type ?? '' }
      : { key: 'manual', name: '手动提交', type: '' };
    const items: FeedItem[] = [];
    try {
      const xml = await this.fetchUrl(url, DEFAULT_TIMEOUT_MS);
      if (looksLikeFeedXml(xml)) {
        let parsed = parseFeed(xml)
          .map((i: FeedItem): FeedItem => {
            if (/^https?:\/\//.test(i.url) || !/^https?:\/\//.test(url)) return i;
            try {
              return { ...i, url: new URL(i.url, url).href };
            } catch {
              return i;
            }
          })
          .filter((i: FeedItem) => i.title && /^https?:\//.test(i.url))
          .slice(0, MAX_ITEMS_PER_SOURCE);
        if (isSitemapXml(xml)) {
          parsed = (await this.enrichSitemapItems(parsed, {
            retryCount: 0,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          })).filter((i: FeedItem) => i.content.length > 0);
        }
        items.push(...parsed);
      }
    } catch {
      // 非 feed 页面走 crawler 兜底
    }
    if (items.length === 0) {
      const markdown = await this.plugins.crawlPage(url);
      items.push({ title: extractMarkdownTitle(markdown, meta.name), url, publishedAt: null, content: markdown });
    }
    const stats: IngestStats = { inserted: 0, skipped: 0, analyzed: 0, failedArticles: 0 };
    for (const item of items) {
      const result = await this.ingestItem(item, source, meta);
      if (result === 'skipped') {
        stats.skipped += 1;
      } else {
        stats.inserted += 1;
        if (result === 'failed') {
          stats.failedArticles += 1;
        } else {
          stats.analyzed += 1;
        }
      }
    }
    return {
      ...stats,
      success: stats.failedArticles < items.length,
      message: `新增 ${stats.inserted} 篇（分析成功 ${stats.analyzed}），跳过重复 ${stats.skipped} 篇`,
    };
  }

  /** 重新分析已有文章 */
  async reanalyzeArticle(articleId: string): Promise<void> {
    const rows = await this.db.select().from(ai4sArticle).where(eq(ai4sArticle.id, articleId));
    if (rows.length === 0) {
      throw new Error('情报不存在');
    }
    const article = rows[0];
    await this.db.update(ai4sArticle).set({ analysisStatus: 'analyzing' }).where(eq(ai4sArticle.id, articleId));
    try {
      const analysis = await this.analyzeContent(article.title, article.summary || article.title);
      const discard = this.isDiscardable(analysis) || analysis.score <= 0;
      await this.db
        .update(ai4sArticle)
        .set({
          analysisStatus: discard ? 'discarded' : 'done',
          category: analysis.category,
          score: analysis.score,
          importanceReason: analysis.importanceReason,
          contentType: analysis.contentType,
          moatTags: analysis.moatTags,
          summary: analysis.summary,
          failureReason: discard
            ? analysis.score <= 0
              ? '零分内容（非情报，多为导航页/介绍页/无实质动态），已自动剔出'
              : '低价值内容（评分≤1且无法归类，多为抓取残渣或导航页），已自动丢弃'
            : '',
        })
        .where(eq(ai4sArticle.id, articleId));
    } catch (error) {
      await this.db
        .update(ai4sArticle)
        .set({ analysisStatus: 'failed', failureReason: String(error).slice(0, 500) })
        .where(eq(ai4sArticle.id, articleId));
      throw error;
    }
  }

  /** 存量「其他」类重分类：低分垃圾批量丢弃，其余重新 AI 分类 */
  async recategorizeOtherArticles(): Promise<IAi4sRecategorizeResult> {
    const lowScore = await this.db
      .update(ai4sArticle)
      .set({
        analysisStatus: 'discarded',
        failureReason: '低价值内容（评分≤1且无法归类，多为抓取残渣或导航页），已自动丢弃',
      })
      .where(
        and(
          eq(ai4sArticle.category, '其他'),
          eq(ai4sArticle.analysisStatus, 'done'),
          sql`${ai4sArticle.score} <= 1`,
        ),
      )
      .returning({ id: ai4sArticle.id });
    let discarded = lowScore.length;

    const targets = await this.db
      .select()
      .from(ai4sArticle)
      .where(and(eq(ai4sArticle.category, '其他'), eq(ai4sArticle.analysisStatus, 'done')));

    let recategorized = 0;
    let stillOther = 0;
    for (const article of targets) {
      try {
        const analysis = await this.analyzeContent(article.title, article.summary || article.title);
        const discard = this.isDiscardable(analysis);
        await this.db
          .update(ai4sArticle)
          .set({
            analysisStatus: discard ? 'discarded' : 'done',
            category: analysis.category,
            score: analysis.score,
            importanceReason: analysis.importanceReason,
            contentType: analysis.contentType,
            moatTags: analysis.moatTags,
            summary: analysis.summary,
            failureReason: discard ? '低价值内容（评分≤1且无法归类，多为抓取残渣或导航页），已自动丢弃' : '',
            updatedAt: new Date(),
          })
          .where(eq(ai4sArticle.id, article.id));
        if (discard) {
          discarded += 1;
        } else if (analysis.category !== '其他') {
          recategorized += 1;
        } else {
          stillOther += 1;
        }
      } catch (error) {
        this.logger.warn(`重分类失败 ${article.url}: ${String(error).slice(0, 120)}`);
        stillOther += 1;
      }
    }

    return {
      success: true,
      discarded,
      recategorized,
      stillOther,
      message: `已丢弃低价值内容 ${discarded} 篇，重新归类 ${recategorized} 篇，仍属「其他」${stillOther} 篇`,
    };
  }

  /** 今日已分析篇数（每日任务分析上限用） */
  async analyzedTodayCount(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(ai4sArticle)
      .where(gte(ai4sArticle.crawledAt, start));
    return Number(rows[0]?.count ?? 0);
  }

  get dailyAnalyzeLimit(): number {
    return DAILY_ANALYZE_LIMIT;
  }
}

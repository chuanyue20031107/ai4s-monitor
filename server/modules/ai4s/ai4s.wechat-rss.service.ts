import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { ai4sSource } from '@server/database/schema';

export interface WechatRssSyncItem {
  sourceKey: string;
  accountName: string;
  entityName: string;
  groupName?: string;
  priority?: string;
  feedId?: string;
  enabled?: boolean;
}

export interface WechatRssSyncRequest {
  baseUrl: string;
  items: WechatRssSyncItem[];
  dryRun?: boolean;
}

export interface WechatRssSyncItemResult {
  sourceKey: string;
  accountName: string;
  action: 'created' | 'updated' | 'would_create' | 'would_update';
  feedUrl: string | null;
  enabled: boolean;
}

export interface WechatRssSyncResult {
  created: number;
  updated: number;
  pending: number;
  dryRun: boolean;
  items: WechatRssSyncItemResult[];
}

type SourceRow = typeof ai4sSource.$inferSelect;

@Injectable()
export class Ai4sWechatRssService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private normalizeBaseUrl(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
      throw new BadRequestException('WeRSS baseUrl 不能为空');
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException('WeRSS baseUrl 不是有效 URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('WeRSS baseUrl 仅支持 http(s)');
    }
    return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  }

  private cleanText(value: unknown, maxLength: number): string {
    return String(value ?? '').trim().slice(0, maxLength);
  }

  private buildFeedUrl(baseUrl: string, feedId: string): string {
    return new URL(`feed/${encodeURIComponent(feedId)}.xml`, baseUrl).href;
  }

  private validateItem(item: WechatRssSyncItem, index: number): WechatRssSyncItem {
    const sourceKey = this.cleanText(item?.sourceKey, 50);
    const accountName = this.cleanText(item?.accountName, 255);
    const entityName = this.cleanText(item?.entityName, 255);
    if (!sourceKey) {
      throw new BadRequestException(`items[${index}].sourceKey 不能为空`);
    }
    if (!accountName) {
      throw new BadRequestException(`items[${index}].accountName 不能为空`);
    }
    if (!entityName) {
      throw new BadRequestException(`items[${index}].entityName 不能为空`);
    }
    return {
      sourceKey,
      accountName,
      entityName,
      groupName: this.cleanText(item.groupName, 100),
      priority: this.cleanText(item.priority, 10),
      feedId: this.cleanText(item.feedId, 255),
      enabled: Boolean(item.enabled),
    };
  }

  private async findBySourceKey(sourceKey: string): Promise<SourceRow | null> {
    const rows = await this.db
      .select()
      .from(ai4sSource)
      .where(eq(ai4sSource.sourceKey, sourceKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async syncSources(dto: WechatRssSyncRequest): Promise<WechatRssSyncResult> {
    if (!dto || !Array.isArray(dto.items)) {
      throw new BadRequestException('items 必须是数组');
    }
    if (dto.items.length > 500) {
      throw new BadRequestException('单次最多同步 500 个微信公众号来源');
    }

    const baseUrl = this.normalizeBaseUrl(dto.baseUrl);
    const dryRun = Boolean(dto.dryRun);
    const result: WechatRssSyncResult = {
      created: 0,
      updated: 0,
      pending: 0,
      dryRun,
      items: [],
    };

    for (let index = 0; index < dto.items.length; index += 1) {
      const item = this.validateItem(dto.items[index], index);
      const feedId = item.feedId ?? '';
      const feedUrl = feedId ? this.buildFeedUrl(baseUrl, feedId) : null;
      // 没有 feedId 的来源只作为待配置占位，必须保持 disabled，避免健康检查/抓取误报。
      const enabled = feedUrl ? Boolean(item.enabled) : false;
      if (!feedUrl) result.pending += 1;

      const existing = await this.findBySourceKey(item.sourceKey);
      if (dryRun) {
        result.items.push({
          sourceKey: item.sourceKey,
          accountName: item.accountName,
          action: existing ? 'would_update' : 'would_create',
          feedUrl,
          enabled,
        });
        if (existing) result.updated += 1;
        else result.created += 1;
        continue;
      }

      if (existing) {
        await this.db
          .update(ai4sSource)
          .set({
            name: item.entityName,
            groupName: item.groupName || existing.groupName,
            type: existing.type || '微信公众号',
            region: existing.region || '中国',
            wechat: item.accountName,
            feedUrl,
            priority: item.priority || existing.priority,
            enabled,
            crawlStrategy: 'rss',
            crawlStatus: feedUrl === existing.feedUrl ? existing.crawlStatus : 'idle',
            lastError: feedUrl === existing.feedUrl ? existing.lastError : null,
          })
          .where(eq(ai4sSource.id, existing.id));
        result.updated += 1;
        result.items.push({
          sourceKey: existing.sourceKey,
          accountName: item.accountName,
          action: 'updated',
          feedUrl,
          enabled,
        });
        continue;
      }

      await this.db.insert(ai4sSource).values({
        sourceKey: item.sourceKey,
        name: item.entityName,
        groupName: item.groupName || '微信公众号',
        type: '微信公众号',
        region: '中国',
        wechat: item.accountName,
        feedUrl,
        priority: item.priority || null,
        enabled,
        crawlStrategy: 'rss',
        crawlStatus: 'idle',
        notes: '由 WeRSS 公众号 RSS 接入配置同步',
      });
      result.created += 1;
      result.items.push({
        sourceKey: item.sourceKey,
        accountName: item.accountName,
        action: 'created',
        feedUrl,
        enabled,
      });
    }

    return result;
  }
}

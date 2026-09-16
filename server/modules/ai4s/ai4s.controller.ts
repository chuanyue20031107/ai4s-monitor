/**
 * AI4S 情报雷达 — HTTP 接口（/api/ai4s）
 */
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ai4sSettings } from '@server/database/schema';
import type {
  IAi4sAnalyzeUrlRequest,
  IAi4sArticlesResponse,
  IAi4sCrawlAllStartResponse,
  IAi4sDigestResponse,
  IAi4sHealthCheckStartResponse,
  IAi4sHealthCheckStatsResponse,
  IAi4sIngestResult,
  IAi4sPushResult,
  IAi4sRecategorizeResult,
  IAi4sRunsResponse,
  IAi4sSaveDigestRequest,
  IAi4sSettingsResponse,
  IAi4sSourcesResponse,
  IAi4sTestSourceResponse,
  IAi4sUpdateSettingsRequest,
} from '@shared/api.interface';
import { Ai4sService } from './ai4s.service';
import { Ai4sIngestService } from './ai4s.ingest.service';
import {
  Ai4sWechatRssService,
  type WechatRssSyncRequest,
  type WechatRssSyncResult,
} from './ai4s.wechat-rss.service';

@Controller('api/ai4s')
export class Ai4sController {
  constructor(
    private readonly service: Ai4sService,
    private readonly ingest: Ai4sIngestService,
    private readonly wechatRss: Ai4sWechatRssService,
  ) {}

  @Get('articles')
  async listArticles(): Promise<IAi4sArticlesResponse> {
    return { items: await this.service.listArticles() };
  }

  @Get('articles/:id')
  async getArticle(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getArticle(id);
  }

  @Post('articles/analyze')
  async analyzeUrl(@Body() dto: IAi4sAnalyzeUrlRequest): Promise<IAi4sIngestResult> {
    return this.ingest.ingestManualUrl(dto.url);
  }

  @Post('articles/:id/reanalyze')
  async reanalyzeArticle(@Param('id', ParseUUIDPipe) id: string): Promise<IAi4sIngestResult> {
    await this.service.getArticle(id);
    await this.ingest.reanalyzeArticle(id);
    return { success: true, inserted: 1, skipped: 0, analyzed: 1, failedArticles: 0, message: '重新分析完成' };
  }

  @Post('articles/recategorize-other')
  async recategorizeOther(): Promise<IAi4sRecategorizeResult> {
    return this.ingest.recategorizeOtherArticles();
  }

  @Get('sources')
  async listSources(): Promise<IAi4sSourcesResponse> {
    return { items: await this.service.listSources() };
  }

  /**
   * 将 WeRSS 中的公众号 feed_id 批量同步为 ai4s_source RSS 来源。
   * 未配置 feed_id 的项目会强制 disabled，避免被全量抓取或健康检查误判为失败。
   */
  @Post('sources/wechat-rss/sync')
  async syncWechatRssSources(@Body() dto: WechatRssSyncRequest): Promise<WechatRssSyncResult> {
    return this.wechatRss.syncSources(dto);
  }

  @Post('sources/health-check')
  async startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
    return this.service.startHealthCheck();
  }

  @Get('sources/health-check/stats')
  async getHealthCheckStats(): Promise<IAi4sHealthCheckStatsResponse> {
    return { stats: await this.service.getHealthCheckStats() };
  }

  @Post('sources/crawl-all')
  async startCrawlAll(): Promise<IAi4sCrawlAllStartResponse> {
    return this.service.startCrawlAll();
  }

  @Patch('sources/:id/toggle')
  async toggleSource(@Param('id', ParseUUIDPipe) id: string): Promise<IAi4sSourcesResponse> {
    await this.service.toggleSource(id);
    return { items: await this.service.listSources() };
  }

  @Post('sources/:id/crawl')
  async crawlSource(@Param('id', ParseUUIDPipe) id: string): Promise<IAi4sIngestResult> {
    const stats = await this.service.crawlSourceById(id);
    return {
      success: true,
      inserted: stats.inserted,
      skipped: stats.skipped,
      analyzed: stats.analyzed,
      failedArticles: stats.failedArticles,
      message: `新增 ${stats.inserted} 篇（分析成功 ${stats.analyzed}），跳过重复 ${stats.skipped} 篇`,
    };
  }

  @Post('sources/:id/test')
  async testSource(@Param('id', ParseUUIDPipe) id: string): Promise<IAi4sTestSourceResponse> {
    return this.service.testSourceById(id);
  }

  @Get('settings')
  async getSettings(): Promise<IAi4sSettingsResponse> {
    return { settings: await this.service.getSettings() };
  }

  @Put('settings')
  async updateSettings(@Body() dto: IAi4sUpdateSettingsRequest): Promise<IAi4sSettingsResponse> {
    const patch: Partial<typeof ai4sSettings.$inferInsert> = {};
    if (dto.dailyCrawlEnabled !== undefined) patch.dailyCrawlEnabled = dto.dailyCrawlEnabled;
    if (dto.dailyPushEnabled !== undefined) patch.dailyPushEnabled = dto.dailyPushEnabled;
    if (dto.pushTime !== undefined) patch.pushTime = dto.pushTime;
    if (dto.feishuReceivers !== undefined) patch.feishuReceivers = dto.feishuReceivers;
    if (dto.groupWebhookUrl !== undefined) {
      const url = dto.groupWebhookUrl.trim();
      if (url && !/^https?:\/\//.test(url)) {
        throw new BadRequestException('群机器人 Webhook 需以 http(s):// 开头');
      }
      patch.groupWebhookUrl = url;
    }
    if (dto.weeklyReportEnabled !== undefined) patch.weeklyReportEnabled = dto.weeklyReportEnabled;
    if (dto.weeklyReportDay !== undefined) {
      const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      if (!days.includes(dto.weeklyReportDay)) {
        throw new BadRequestException('周报生成日仅支持 mon~sun');
      }
      patch.weeklyReportDay = dto.weeklyReportDay;
    }
    if (dto.concurrency !== undefined) patch.concurrency = dto.concurrency;
    if (dto.retryCount !== undefined) patch.retryCount = dto.retryCount;
    if (dto.timeoutSeconds !== undefined) patch.timeoutSeconds = dto.timeoutSeconds;
    if (dto.minScore !== undefined) patch.minScore = dto.minScore;
    if (dto.focusCategories !== undefined) patch.focusCategories = dto.focusCategories;
    if (dto.retentionDays !== undefined) patch.retentionDays = dto.retentionDays;
    if (dto.crawlWindowStart !== undefined) patch.crawlWindowStart = dto.crawlWindowStart;
    if (dto.crawlWindowEnd !== undefined) patch.crawlWindowEnd = dto.crawlWindowEnd;
    return { settings: await this.service.updateSettings(patch) };
  }

  @Get('runs')
  async listRuns(): Promise<IAi4sRunsResponse> {
    return { items: await this.service.listRuns() };
  }

  @Get('digest')
  async getDigest(@Query('type') type?: string): Promise<IAi4sDigestResponse> {
    const digestType = type === 'weekly' ? 'weekly' : 'daily';
    return { digest: await this.service.getLatestDigest(digestType) };
  }

  @Post('digest')
  async saveDigest(@Body() dto: IAi4sSaveDigestRequest): Promise<IAi4sDigestResponse> {
    if (!dto.content || typeof dto.content !== 'string' || dto.content.trim() === '') {
      throw new BadRequestException('摘要内容不能为空');
    }
    const articleCount = Number(dto.articleCount);
    if (!Number.isInteger(articleCount) || articleCount < 0) {
      throw new BadRequestException('文章数量必须为非负整数');
    }
    const digestType = dto.digestType ?? 'daily';
    if (digestType !== 'daily' && digestType !== 'weekly') {
      throw new BadRequestException('摘要类型仅支持 daily / weekly');
    }
    return { digest: await this.service.saveDigest(dto.content.trim(), articleCount, digestType) };
  }

  @Post('push')
  async pushDigest(@Query('type') type?: string): Promise<IAi4sPushResult> {
    const digestType = type === 'weekly' ? 'weekly' : 'daily';
    return this.service.pushLatestDigest(digestType);
  }
}

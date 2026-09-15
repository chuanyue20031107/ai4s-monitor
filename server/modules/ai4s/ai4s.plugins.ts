/**
 * AI4S 情报雷达 — 服务端插件调用封装（CapabilityService）
 * 1. ai4s_intelligence_crawler_1 (crawlWebPage / stream) 入参 { page_url }，chunk { content }
 * 2. ai4s_intelligence_article_structured_analysis_1 (textToJson / unary)
 *    入参 { article_title, article_content }，出参 { category, importance_score, importance_reason, content_type, moat_tags, chinese_summary }
 * 3. agent_reply_1 (textGenerate / stream) 入参 { user_message, session_context }，chunk { content }
 * 4. ai4s_daily_intelligence_feishu_push_1 (send_feishu_message / unary)
 *    入参 { title_content, content, receiver_user_list }
 */
import { Injectable, Logger } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';

const CRAWLER_ID = 'ai4s_intelligence_crawler_1';
const ANALYZER_ID = 'ai4s_intelligence_article_structured_analysis_1';
const DIGEST_ID = 'agent_reply_1';
const PUSHER_ID = 'ai4s_daily_intelligence_feishu_push_1';

export interface AnalyzerOutput {
  category?: string;
  importance_score?: number;
  importance_reason?: string;
  content_type?: string;
  /** 插件 schema 声明为逗号分隔字符串；兼容旧版本数组返回。 */
  moat_tags?: string[] | string;
  chinese_summary?: string;
}

function pickStream<T>(stream: unknown): AsyncIterable<T> {
  const maybe = stream as { output?: AsyncIterable<T> };
  if (maybe && maybe.output && typeof maybe.output[Symbol.asyncIterator] === 'function') {
    return maybe.output;
  }
  return stream as AsyncIterable<T>;
}

@Injectable()
export class Ai4sPluginService {
  private readonly logger = new Logger(Ai4sPluginService.name);

  constructor(private readonly capabilityService: CapabilityService) {}

  /** web-crawler 兜底抓取页面 Markdown */
  async crawlPage(pageUrl: string): Promise<string> {
    const executor = this.capabilityService.load(CRAWLER_ID);
    const stream = executor.callStream('crawlWebPage', { page_url: pageUrl });
    let content = '';
    for await (const chunk of pickStream<{ content?: string }>(stream)) {
      content += chunk?.content ?? '';
    }
    if (!content.trim()) {
      throw new Error(`抓取内容为空：${pageUrl}`);
    }
    return content;
  }

  /** 单篇文章结构化分析 */
  async analyzeArticle(articleTitle: string, articleContent: string): Promise<AnalyzerOutput> {
    const executor = this.capabilityService.load(ANALYZER_ID);
    const result = await executor.call('textToJson', {
      article_title: articleTitle,
      article_content: articleContent,
    });
    if (!result || typeof result !== 'object') {
      throw new Error('分析结果为空');
    }
    return result as AnalyzerOutput;
  }

  /** 生成每日摘要（server 侧消费完整流） */
  async generateText(userMessage: string, sessionContext = ''): Promise<string> {
    const executor = this.capabilityService.load(DIGEST_ID);
    const stream = executor.callStream('textGenerate', {
      user_message: userMessage,
      session_context: sessionContext,
    });
    let full = '';
    for await (const chunk of pickStream<{ content?: string }>(stream)) {
      full += chunk?.content ?? '';
    }
    if (!full.trim()) {
      throw new Error('文本生成结果为空');
    }
    return full;
  }

  /** 发送飞书卡片（个人走 receiver_user_list 单次最多 200；群推送改走自定义机器人 Webhook，见 Ai4sService）
   * 注意：receiver_user_list 仅接受用户 ID，群 chat_id 会被平台报 10003 全部无效
   */
  async pushFeishuCard(
    titleContent: string,
    content: string,
    receiverUserList: string[],
  ): Promise<void> {
    if (receiverUserList.length === 0) {
      throw new Error('未配置飞书接收人');
    }
    const executor = this.capabilityService.load(PUSHER_ID);
    for (let i = 0; i < receiverUserList.length; i += 200) {
      await executor.call('send_feishu_message', {
        title_content: titleContent,
        content,
        receiver_user_list: receiverUserList.slice(i, i + 200),
      });
    }
  }
}

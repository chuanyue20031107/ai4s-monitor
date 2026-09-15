/**
 * AI4S 情报雷达 — 插件调用服务层（全部为真实 capabilityClient 调用，无 mock）
 *
 * 1. ai4s_intelligence_crawler_1 (web-crawler / crawlWebPage / stream)
 *    入参 { page_url }，chunk 字段 { content }（增量片段，需累加）
 * 2. ai4s_intelligence_article_structured_analysis_1 (ai-text-to-json / textToJson / unary)
 *    入参 { article_title, article_content }
 *    出参 { category, importance_score, importance_reason, content_type, moat_tags, chinese_summary }
 * 3. ai4s_daily_intelligence_feishu_push_1 (send-feishu-message / send_feishu_message / unary)
 *    入参 { title_content, content, receiver_user_list }，出参 { success }
 * 4. agent_reply_1 (ai-text-generate / textGenerate / stream)
 *    入参 { user_message, session_context }，chunk 字段 { content }（增量片段，需累加）
 */
import { capabilityClient, logger } from '@lark-apaas/client-toolkit';
import type {
  Ai4sDailyIntelligenceFeishuPushOneInput,
  Ai4sDailyIntelligenceFeishuPushOneOutput,
  Ai4sIntelligenceArticleStructuredAnalysisOneInput,
  Ai4sIntelligenceArticleStructuredAnalysisOneOutput,
  Ai4sIntelligenceCrawlerOneInput,
  Ai4sIntelligenceCrawlerOneOutput,
} from '@shared/plugin-types';
import { PLUGIN_IDS } from '@/data/ai4s';

/** 流式返回可能是 AsyncIterable，也可能是 { output: AsyncIterable }，统一归一化 */
function pickStream<T>(stream: unknown): AsyncIterable<T> {
  const maybe = stream as { output?: AsyncIterable<T> };
  if (maybe && maybe.output && typeof maybe.output[Symbol.asyncIterator] === 'function') {
    return maybe.output;
  }
  return stream as AsyncIterable<T>;
}

/** 抓取来源页面（RSS / 会议页 / 官网），返回页面 Markdown 内容；网络瞬时失败自动重试 */
export async function crawlPage(pageUrl: string): Promise<string> {
  const executor = (capabilityClient as any).load(PLUGIN_IDS.crawler);
  const input: Ai4sIntelligenceCrawlerOneInput = { page_url: pageUrl };

  const attempt = async (): Promise<string> => {
    const stream = (executor as any).callStream('crawlWebPage', input);
    let content = '';
    for await (const chunk of pickStream<Ai4sIntelligenceCrawlerOneOutput>(stream)) {
      content += chunk?.content ?? '';
    }
    return content;
  };

  let lastError: unknown = null;
  const maxAttempts = 2;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const content = await attempt();
      if (!content.trim()) {
        throw new Error('抓取内容为空');
      }
      return content;
    } catch (error) {
      lastError = error;
      logger.warn(`网页抓取失败（第 ${i + 1}/${maxAttempts} 次） ${pageUrl}`, String(error));
      // 页面解析失败属于目标页面自身问题（动态渲染/不可访问），重试无意义，快速失败
      if (String(error).includes('pageParseFailed')) {
        throw new Error(`目标页面解析失败（页面可能为动态渲染或暂不可访问）：${pageUrl}`);
      }
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  throw new Error(
    `网页抓取失败（已重试 ${maxAttempts} 次）：可能是网络波动或目标页面不可访问，请稍后重试（${String(lastError).slice(0, 60)}）`,
  );
}

/** 单篇文章结构化分析（分类 / 评分 / 理由 / 内容类型 / 护城河标签 / 中文摘要） */
export async function analyzeArticleContent(
  articleTitle: string,
  articleContent: string,
): Promise<Ai4sIntelligenceArticleStructuredAnalysisOneOutput> {
  const executor = (capabilityClient as any).load(PLUGIN_IDS.analyzer);
  const input: Ai4sIntelligenceArticleStructuredAnalysisOneInput = {
    article_title: articleTitle,
    article_content: articleContent,
  };
  const result = await (executor as any).call('textToJson', input);
  if (!result || typeof result !== 'object') {
    throw new Error('分析结果为空');
  }
  return result as Ai4sIntelligenceArticleStructuredAnalysisOneOutput;
}

/** 生成每日情报摘要 / 回答自然语言情报查询（流式），onChunk 回调返回截至当前的累加全文 */
export async function generateDailyDigestText(
  prompt: string,
  onChunk?: (full: string) => void,
  sessionContext = '',
): Promise<string> {
  const executor = (capabilityClient as any).load(PLUGIN_IDS.digest);
  const stream = (executor as any).callStream('textGenerate', {
    user_message: prompt,
    session_context: sessionContext,
  });
  let full = '';
  for await (const chunk of pickStream<{ content?: string }>(stream)) {
    const piece = chunk?.content ?? '';
    if (piece) {
      full += piece;
      onChunk?.(full);
    }
  }
  if (!full.trim()) {
    throw new Error('摘要生成结果为空');
  }
  return full;
}

/** 推送飞书卡片消息（每日情报） */
export async function pushFeishuCard(
  input: Ai4sDailyIntelligenceFeishuPushOneInput,
): Promise<Ai4sDailyIntelligenceFeishuPushOneOutput> {
  const executor = (capabilityClient as any).load(PLUGIN_IDS.pusher);
  const result = await (executor as any).call('send_feishu_message', input);
  if (!result || typeof result !== 'object') {
    throw new Error('推送返回异常');
  }
  return result as Ai4sDailyIntelligenceFeishuPushOneOutput;
}

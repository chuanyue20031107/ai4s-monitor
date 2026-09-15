/**
 * AI4S 情报雷达 — 官网页面文章链接提取（纯函数）
 * crawler 兜底前先解析页面 <a> 标签中的站内文章链接，逐条入库
 */

export interface PageLink {
  url: string;
  title: string;
}

/** 链接文本为导航类废话时丢弃 */
const JUNK_TEXT_RE =
  /^(read more|more|learn more|view all|see all|show more|details?|click here|here|home|back|next|prev(ious)?|download|subscribe|sign up|log ?in|contact|about|查看更多|更多|详情|了解详情|点击|下载|订阅|登录|联系|首页|返回|上一页|下一页)\s*[»>]?$/i;

/** 路径含这些词的链接优先视为文章页 */
const ARTICLE_PATH_RE =
  /(news|blog|post|article|press|update|research|publication|insight|story|announce|notice|event|report|paper|highlight|media)/i;

/** 导航/功能性路径直接排除 */
const NAV_PATH_RE =
  /^\/(about|contact|privacy|terms|legal|cookie|login|signin|signup|register|careers|jobs|team|people|faq|help|support|search|tag|tags|category|categories|author|user|account|cart|shop|products?|services?|solutions?|platform|pricing|docs|api)\b/i;

/** 末段为栏目词本身 → 列表/导航页（news.html、/news-events 等） */
const COLUMN_TAIL_RE =
  /^(news|notices?|tongzhi|gonggao|xinwen|list|lists|channel|category|categories|tag|tags|science|research|events?|insights?|blogs?|posts?|media|press|update|updates|news-events|newslist|artlist|zhihu|weixin)(\.(html?|php|aspx?|jsp))?\/?$/i;

/** 末段为 1~3 位纯数字（可带扩展名）→ 分页页码（/news/12.html、/science/1） */
const PAGINATION_TAIL_RE = /^\d{1,3}(\.(html?|php|aspx?|jsp))?$/i;

/** 路径合介绍页/组织页段：/sites/heidelberg、/cn/cores/xxx 等 */
const ORG_SEGMENT_RE =
  /^(about|company|team|people|members?|sites?|cores?|facilit(?:y|ies)|careers|jobs|history|mission|governance|partners?|impressum|alumni)$/i;

/** 文章 id 类查询参数：路径深度不足时，必须有此类参数才算文章 */
const ID_QUERY_RE = /[?&](id|aid|tid|sid|pid|post|page_id|article_id|contentid|cid)=\d{3,}/i;

/** 非文章资源后缀直接排除 */
const FILE_EXT_RE = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|mp[34]|webm|woff2?|ttf|eot)(\?|$)/i;

const TRACKING_PARAMS = /^(utm_|spm|from|ref|source|share_|channel)/i;

interface RawLink {
  url: string;
  title: string;
  score: number;
  order: number;
}

/** 归一化链接：去 hash、去跟踪参数、去尾斜杠，返回 null 表示不可用 */
function normalizeLink(href: string, pageUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href, pageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/^www\./, '');
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  if (!host || !pageHost) return null;
  // 仅同站（含子域）链接，排除外链与社交账号
  if (host !== pageHost && !host.endsWith(`.${pageHost}`)) return null;
  const params = [...parsed.searchParams.entries()];
  parsed.search = '';
  for (const [key, value] of params) {
    if (!TRACKING_PARAMS.test(key)) parsed.searchParams.append(key, value);
  }
  parsed.hash = '';
  let out = parsed.toString();
  if (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** 判断链接是否可能是文章页：路径深度、导航/栏目/分页/介绍页黑名单、资源后缀 */
export function isArticleLikeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (NAV_PATH_RE.test(path)) return false;
    if (FILE_EXT_RE.test(path)) return false;
    const segments = path.split('/').filter((s: string) => s.length > 0);
    if (
      segments.some((s: string) => ORG_SEGMENT_RE.test(s.replace(/\.(html?|php|aspx?|jsp)$/i, '')))
    ) {
      return false;
    }
    const last = segments[segments.length - 1] ?? '';
    if (/^index\.(html?|php|aspx?)$/i.test(last) && !parsed.search) return false;
    if (PAGINATION_TAIL_RE.test(last)) return false;
    if (COLUMN_TAIL_RE.test(last)) return false;
    if (segments.length >= 2) return true;
    // 深度不足时，仅当查询串含长数字 id 或路径含 4 位以上数字视为文章
    return ID_QUERY_RE.test(parsed.search) || /\/\d{4,}/.test(path);
  } catch {
    return false;
  }
}

/**
 * 从页面 HTML 提取候选文章链接（最多 30 条，按文章可能性排序）
 * 规则：同站 <a> 链接 + 路径深度 ≥2（或带查询串）+ 非导航/资源/分页废话文本
 */
export function extractArticleLinks(html: string, pageUrl: string): PageLink[] {
  const aTagRe = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Map<string, RawLink>();
  let order = 0;
  let match: RegExpExecArray | null;
  while ((match = aTagRe.exec(html)) !== null) {
    const href = (match[1] ?? match[2] ?? '').trim();
    const title = match[3]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    order += 1;
    if (!href || href.startsWith('#') || !title || title.length < 4) continue;
    if (JUNK_TEXT_RE.test(title)) continue;
    const url = normalizeLink(href, pageUrl);
    if (!url || url === pageUrl.replace(/\/$/, '')) continue;
    if (!isArticleLikeLink(url)) continue;
    if (seen.has(url)) {
      const existing = seen.get(url) as RawLink;
      if (title.length > existing.title.length) existing.title = title;
      continue;
    }
    let score = 1;
    if (ARTICLE_PATH_RE.test(url)) score += 2;
    if (/\/\d{4,}/.test(url) || /[?&](id|p|post|page_id)=\d+/.test(url)) score += 1;
    if (title.length >= 12) score += 1;
    seen.set(url, { url, title, score, order });
  }
  return [...seen.values()]
    .sort((a: RawLink, b: RawLink) => b.score - a.score || a.order - b.order)
    .slice(0, 30)
    .map((l: RawLink) => ({ url: l.url, title: l.title }));
}

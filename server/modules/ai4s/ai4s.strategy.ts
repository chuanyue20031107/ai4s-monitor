/**
 * AI4S 情报雷达 — 抓取策略纯函数模块
 * URL 规范化 / robots.txt 检查（origin 级缓存 1 小时）/ RSS 自动发现 / 失败分类与建议映射
 */
import type { Ai4sCrawlStatus } from '@shared/api.interface';

// ---------- URL 规范化 ----------

/** trim + 协议补全（含点、无空格、无中文时补 https://），非法返回 null */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    const looksLikeHost =
      candidate.includes('.') && !/\s/.test(candidate) && !/[\u4e00-\u9fff]/.test(candidate);
    if (!looksLikeHost) return null;
    candidate = `https://${candidate}`;
  }
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

// ---------- robots.txt ----------

export interface RobotsResult {
  allowed: boolean;
  sitemapUrl: string | null;
  reason: string;
}

interface RobotsRules {
  expiresAt: number;
  disallows: string[];
  sitemapUrl: string | null;
}

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const robotsCache = new Map<string, RobotsRules>();

/** 解析 robots.txt：User-agent: * 分组的 Disallow 前缀规则 + 第一个 Sitemap 行 */
function parseRobots(text: string): { disallows: string[]; sitemapUrl: string | null } {
  const disallows: string[] = [];
  let sitemapUrl: string | null = null;
  let inStarGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      inStarGroup = false; // 空行结束当前分组
      continue;
    }
    if (line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === 'user-agent') {
      inStarGroup = value === '*';
    } else if (key === 'sitemap') {
      if (!sitemapUrl && value) sitemapUrl = value;
    } else if (key === 'disallow' && inStarGroup && value) {
      disallows.push(value.split('#')[0].trim());
    }
  }
  return { disallows, sitemapUrl };
}

function evaluateRobots(url: string, rules: RobotsRules): RobotsResult {
  let path = '/';
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return { allowed: true, sitemapUrl: rules.sitemapUrl, reason: '地址无效，默认允许' };
  }
  const hit = rules.disallows.find((rule: string) => rule !== '' && path.startsWith(rule));
  if (hit) {
    return { allowed: false, sitemapUrl: rules.sitemapUrl, reason: `robots.txt Disallow: ${hit}` };
  }
  return { allowed: true, sitemapUrl: rules.sitemapUrl, reason: 'robots.txt 允许抓取' };
}

/** 检查 url 是否被站点 robots.txt 允许抓取（缓存 1 小时；请求失败时宽松放行） */
export async function isAllowedByRobots(url: string, timeoutMs: number): Promise<RobotsResult> {
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    return { allowed: true, sitemapUrl: null, reason: '地址无效，跳过 robots 检查' };
  }
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) {
    return evaluateRobots(url, cached);
  }
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      robotsCache.set(origin, { expiresAt: Date.now() + ROBOTS_TTL_MS, disallows: [], sitemapUrl: null });
      return { allowed: true, sitemapUrl: null, reason: `robots.txt 不可用（HTTP ${res.status}），默认允许` };
    }
    const parsed = parseRobots(await res.text());
    const rules: RobotsRules = { expiresAt: Date.now() + ROBOTS_TTL_MS, ...parsed };
    robotsCache.set(origin, rules);
    return evaluateRobots(url, rules);
  } catch (error) {
    return {
      allowed: true,
      sitemapUrl: null,
      reason: `robots.txt 请求失败（${String(error).slice(0, 80)}），默认允许`,
    };
  }
}

// ---------- RSS 自动发现 ----------

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(tag)) !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/** 从 HTML head 中发现 <link rel="alternate" type="application/(rss|atom)+xml"> 的绝对地址 */
export function discoverFeedLink(html: string, pageUrl: string): string | null {
  LINK_TAG_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = LINK_TAG_RE.exec(html)) !== null) {
    const attrs = parseAttrs(tag[0]);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const type = (attrs.get('type') ?? '').toLowerCase();
    const href = attrs.get('href') ?? '';
    if (!rel.includes('alternate') || !/^application\/(rss|atom)+xml$/.test(type) || !href) {
      continue;
    }
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

// ---------- 探测路径与类型判定 ----------

/** 常见 feed/sitemap 探测路径（每条探测前必须先过 robots 检查） */
export const FEED_PROBE_PATHS = ['/rss.xml', '/feed/', '/atom.xml', '/sitemap.xml'];

/** 来源类型是否为会议/活动类（走 entry 通道） */
export function isConferenceType(sourceType: string): boolean {
  return /会议|大会|活动|展会/.test(sourceType);
}

// ---------- 失败分类与修复建议 ----------

/** 按错误文本归类抓取失败状态（9 种 Ai4sCrawlStatus 中的失败类） */
export function classifyCrawlError(error: unknown): Ai4sCrawlStatus {
  const text = String(error);
  if (/robots_blocked|robots\.txt 禁止/.test(text)) return 'robots_blocked';
  if (/TimeoutError|AbortError|aborted/i.test(text)) return 'timeout';
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|ECONNRESET/.test(text)) return 'network_error';
  if (/HTTP 40[13]|needs_config/.test(text)) return 'needs_config';
  if (/HTTP 40[04]|HTTP 410|invalid_url/.test(text)) return 'invalid_url';
  if (/parse_failed|pageParseFailed|解析失败|XML 无/.test(text)) return 'parse_failed';
  return 'failed';
}

const STATUS_SUGGESTIONS: Record<Ai4sCrawlStatus, string> = {
  idle: '尚未执行抓取，可先运行健康检查',
  ok: '抓取链路正常，无需处理',
  no_content: '解析到 0 条条目，属正常现象，稍后自动重试',
  invalid_url: '地址无效或不存在，请更新来源地址',
  robots_blocked: 'robots.txt 禁止抓取，请改用官方 RSS 地址或联系站点管理员',
  timeout: '网络响应慢，建议增大超时或稍后重试',
  network_error: '站点无法访问或已下线',
  parse_failed: '内容解析失败，请人工确认地址或改用 crawler 策略',
  needs_config: '需要登录或人工配置，请补充有效地址',
  failed: '抓取失败，请查看诊断信息或稍后重试',
};

/** 状态对应的修复建议文案 */
export function suggestionForStatus(status: Ai4sCrawlStatus): string {
  return STATUS_SUGGESTIONS[status];
}

/**
 * AI4S 情报雷达 — RSS/Atom/Sitemap 轻量解析器（无三方依赖）
 * 服务端直接 fetch feed_url，优先解析出结构化条目；解析不出则由上层回退 web-crawler 插件
 */

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: Date | null;
  content: string;
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanText(value: string): string {
  return decodeEntities(stripCdata(value))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? cleanText(m[1]) : '';
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 解析 RSS 2.0 / Atom / Sitemap XML，返回结构化条目（无条目返回空数组） */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = pickTag(block, 'title');
    const link = pickTag(block, 'link') || pickTag(block, 'guid');
    if (!title || !link) continue;
    items.push({
      title: title.slice(0, 200),
      url: link,
      publishedAt: parseDate(pickTag(block, 'pubDate') || pickTag(block, 'dc:date')),
      content: (pickTag(block, 'description') || pickTag(block, 'content:encoded')).slice(0, 6000),
    });
  }

  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of entryBlocks) {
    const title = pickTag(block, 'title');
    const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : '';
    if (!title || !link) continue;
    items.push({
      title: title.slice(0, 200),
      url: link,
      publishedAt: parseDate(pickTag(block, 'updated') || pickTag(block, 'published')),
      content: (pickTag(block, 'summary') || pickTag(block, 'content')).slice(0, 6000),
    });
  }

  if (items.length === 0) {
    const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
    for (const block of urlBlocks) {
      const loc = pickTag(block, 'loc');
      if (!loc) continue;
      items.push({ title: loc.slice(-80), url: loc, publishedAt: parseDate(pickTag(block, 'lastmod')), content: '' });
    }
  }

  return items;
}

/** 判断响应内容是否为 XML feed（RSS/Atom/Sitemap） */
export function looksLikeFeedXml(text: string): boolean {
  const head = text.slice(0, 1000).toLowerCase();
  return (
    head.includes('<rss') ||
    head.includes('<feed') ||
    head.includes('<urlset') ||
    head.includes('<?xml')
  );
}

/** 判断 XML 是否为 Sitemap（<urlset> 结构，条目无正文） */
export function isSitemapXml(text: string): boolean {
  return text.slice(0, 2000).toLowerCase().includes('<urlset');
}

/** HTML 转纯文本：去 script/style/标签，解码常见实体，折叠空白 */
export function htmlToPlainText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  return decoded.replace(/\s+/g, ' ').trim();
}

/** 从抓取的 Markdown 内容中提取标题 */
export function extractMarkdownTitle(content: string, fallback: string): string {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 25)) {
    const m = line.match(/^#{1,4}\s+(.+)/);
    if (m && m[1].trim().length >= 4) return m[1].trim().slice(0, 120);
  }
  for (const line of lines.slice(0, 25)) {
    if (/^[|>*\-#[\]]/.test(line)) continue;
    if (line.length >= 6) return line.replace(/[#*`_]/g, '').trim().slice(0, 120);
  }
  return `${fallback} · 最新动态`;
}

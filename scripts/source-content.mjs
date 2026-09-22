/** Shared public entry selection and bounded RSS/Sitemap parsing. */
import { canonicalUrl, clean, extractEntries, noiseReason } from './pipeline.mjs';

const FAILURE_STATUSES = new Set(['invalid_url', 'robots_blocked', 'timeout', 'network_error', 'parse_failed', 'needs_config', 'failed', 'http_403', 'http_404', 'http_500', 'dns_error', 'https_error', 'cloudflare_blocked']);
const FALLBACK_RSS = 'https://raw.githubusercontent.com/chuanyue20031107/ai4s-monitor/main/client/public/data/fallback-rss.xml';

export function sourceEntry(source) {
  if (source._wechat) return source._fetchUrl || '';
  if (FAILURE_STATUSES.has(source.crawlStatus) || source.lastError && FAILURE_STATUSES.has(source.lastError)) {
    const key = encodeURIComponent(String(source.sourceKey || '').trim());
    return key ? `${FALLBACK_RSS}?source=${key}` : FALLBACK_RSS;
  }
  return (['rss', 'sitemap'].includes(source.crawlStrategy) && source.discoveredFeedUrl)
    || source.feedUrl || source.website || source.github || '';
}
export function feedKind(text) {
  const xml = text.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->/g, '').trim();
  if (/^<(rss|feed|rdf:RDF)\b/i.test(xml)) return 'rss';
  if (/^<(urlset|sitemapindex)\b/i.test(xml)) return 'sitemap';
  return '';
}
export function sitemapLinks(text, base) {
  const index = /<sitemapindex\b/i.test(text);
  const tag = index ? 'sitemap' : 'url';
  const links = [];
  for (const [block] of text.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'))) {
    const url = canonicalUrl(clean(block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1] || ''), base);
    if (!url || url === canonicalUrl(base)) continue;
    const lastmod = clean(block.match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1] || '');
    links.push({ url, publishedAt: null, lastmod: Number.isFinite(Date.parse(lastmod)) ? lastmod : null });
    if (links.length >= 1000) break;
  }
  return { index, links };
}
export function feedLinks(html, base) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
    const url = canonicalUrl(attrs.href || '', base);
    return url && /\balternate\b/i.test(attrs.rel || '') && /(?:rss|atom)\+xml/i.test(attrs.type || '') ? [url] : [];
  });
}
export async function sourceEntries(page, get, { maxSitemaps = 4 } = {}) {
  if (feedKind(page.html) !== 'sitemap') {
    const entries = extractEntries(page.html, page.finalUrl);
    let sourceKey = '';
    try { sourceKey = new URL(page.finalUrl).searchParams.get('source') || ''; } catch { /* keep all entries */ }
    return sourceKey ? entries.filter(entry => entry.title.startsWith(`[${sourceKey}]`)) : entries;
  }
  const queue = [page], seenMaps = new Set([page.finalUrl]), seen = new Set(), entries = [];
  let loaded = 1, lastError;
  while (queue.length && entries.length < 100) {
    const current = queue.shift(), { index, links } = sitemapLinks(current.html, current.finalUrl);
    for (const link of links.sort((a, b) => (Date.parse(b.lastmod) || 0) - (Date.parse(a.lastmod) || 0))) {
      if (index) {
        if (loaded >= maxSitemaps || seenMaps.has(link.url)) continue;
        seenMaps.add(link.url); loaded++;
        try {
          const child = await get(link.url);
          if (feedKind(child.html) === 'sitemap') queue.push(child);
        } catch (error) { lastError = error; }
      } else {
        const route = new URL(link.url).pathname;
        if (seen.has(link.url) || /\.(pdf|jpg|png|svg|zip|mp4|xml)$/i.test(route) || noiseReason('', link.url)) continue;
        if (!/(news|blog|article|press|publication|paper|insight|stor(?:y|ies)|posts?|updates?|releases?|20\d{2})/i.test(route)) continue;
        seen.add(link.url);
        entries.push({ ...link, title: '', feedContent: '', fromSitemap: true });
        if (entries.length >= 100) break;
      }
    }
  }
  if (!entries.length && lastError) throw lastError;
  return entries;
}
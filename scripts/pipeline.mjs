/** GitHub-native collection -> evidence queue -> validated ChatGPT batches -> static views.
 * No model credentials, generated code execution, or external database is used here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export const CATEGORIES = ['模型', '数据', 'AI4S 应用', '自动化实验室', '产业与商业', '其他'];
export const CONTENT_TYPES = ['company_claim', 'paper_result', 'media_report'];
export const MOAT_TAGS = ['数据', '模型', '实验自动化', '药物设计', '材料发现', '商业合作', '人才'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const UA = 'AI4S-Monitor/2.0';
const iso = () => new Date().toISOString();
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const articleId = (url) => sha256(url).slice(0, 32);
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Invalid JSON: ${path.basename(file)}`); }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}
export function clean(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (s) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }[s]))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }).replace(/\s+/g, ' ').trim();
}
export function canonicalUrl(href, base) {
  try {
    const u = new URL(String(href).replace(/&amp;/g, '&'), base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (/^(localhost|.*\.localhost|.*\.local)$/i.test(u.hostname)) return null;
    if (isIP(u.hostname.replace(/[\[\]]/g, '')) && !publicAddress(u.hostname.replace(/[\[\]]/g, ''))) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
      if (/^(token|access_token|api_key|key|secret|signature|sig|auth)$/i.test(key)) return null;
    }
    return u.href;
  } catch { return null; }
}
export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127);
  }
  // Restrict IPv6 to global unicast and reject documentation/mapped addresses.
  return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
const tag = (s, name) => (s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '';
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const asDate = (s) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
export function noiseReason(title, url = '') {
  if (/(喷药作业|体检安排|住房.*补贴|升旗仪式|开学典礼|教职工荣休|后勤保障中心|人事人才处|一周会议安排)/i.test(title)) return '非 AI4S 行政通知';
  if (/^(首页|关于我们|联系我们|新闻中心|研究方向|人才招聘|隐私政策|Home|About us|Contact us|Privacy policy|News|Research)$/i.test(title)) return '导航或栏目页';
  if (/\/(jgsz|privacy|contact|login)(\/|\?|$)/i.test(new URL(url || 'https://example.org').pathname)) return '机构导航或管理页面';
  return '';
}
export function extractEntries(html, base) {
  const entries = [], seen = new Set();
  const blocks = [...html.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi)];
  const add = (title, href, publishedAt, content = '') => {
    const url = canonicalUrl(href, base); title = clean(title);
    if (!url || title.length < 5 || title.length > 220 || seen.has(url) || noiseReason(title, url)) return;
    seen.add(url); entries.push({ title, url, publishedAt: asDate(publishedAt), feedContent: clean(content).slice(0, 5000) });
  };
  if (blocks.length) {
    for (const [block] of blocks.slice(0, 30)) {
      const links = [...block.matchAll(/<link\b[^>]*>/gi)].map(([s]) => attrs(s));
      const link = links.find((a) => a.href && (!a.rel || a.rel === 'alternate'))?.href || clean(tag(block, 'link'));
      add(tag(block, 'title'), link, clean(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')),
        tag(block, 'content:encoded') || tag(block, 'content') || tag(block, 'description') || tag(block, 'summary'));
      if (entries.length >= 12) break;
    }
  } else {
    const baseHost = new URL(base).hostname.replace(/^www\./, '');
    for (const [, href, text] of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const u = canonicalUrl(href, base); if (!u || u === canonicalUrl(base)) continue;
      const target = new URL(u), host = target.hostname.replace(/^www\./, '');
      if (host !== baseHost && !host.endsWith(`.${baseHost}`)) continue;
      if (!/(news|blog|article|press|publication|paper|insight|story|20\d{2}|新闻|发布)/i.test(target.pathname + text)) continue;
      add(text, u, null);
      if (entries.length >= 12) break;
    }
  }
  return entries;
}
export function extractContent(html) {
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([s]) => attrs(s));
  const get = (name) => metadata.find((a) => (a.property || a.name || '').toLowerCase() === name)?.content || '';
  const main = tag(html, 'article') || tag(html, 'main');
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((s) => s.length > 45).join('\n');
  const content = clean(main || paragraphs || get('description') || get('og:description')).slice(0, 5000);
  const publishedAt = asDate(get('article:published_time') || get('date') || clean(tag(html, 'pubDate')));
  return { content, publishedAt, extractionMethod: main ? 'article-or-main-excerpt' : paragraphs ? 'paragraph-excerpt' : 'meta-description', contentTruncated: Boolean(main && clean(main).length > 5000 || paragraphs.length > 5000) };
}
// Conservative robots handling: use the most specific user-agent group; uncertain responses stop collection.
export function robotsAllowed(text, target) {
  const groups = []; let current = null, hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || hasRules) { current = { agents: [], rules: [] }; groups.push(current); hasRules = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow'].includes(key)) { current.rules.push({ allow: key === 'allow', value }); hasRules = true; }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && a && UA.toLowerCase().includes(a)));
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const targetUrl = new URL(target), route = targetUrl.pathname + targetUrl.search; let best = { length: -1, allow: true };
  for (const g of selected) for (const r of g.rules) {
    if (!r.value) continue;
    const pattern = r.value.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    if (new RegExp(`^${pattern}`).test(route) && (r.value.length > best.length || r.value.length === best.length && r.allow)) best = { length: r.value.length, allow: r.allow };
  }
  return best.allow;
}
export async function lookupPublic(host, { lookupHost = lookup, timeoutMs = 15000 } = {}) {
  let timer;
  try {
    const ips = await Promise.race([lookupHost(host, { all: true }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('DNS timeout'), { name: 'TimeoutError' })), timeoutMs);
    })]);
    if (!ips.length || ips.some(a => !publicAddress(a.address))) throw new Error('private_address_blocked');
    return ips;
  } finally { clearTimeout(timer); }
}
export function makeFetcher({ timeoutSeconds = 15, maxRequests = 180, fetchImpl = fetch, lookupHost = lookup } = {}) {
  let requests = 0; const robotCache = new Map(), dnsCache = new Map();
  const timeoutMs = Math.min(30, Math.max(3, timeoutSeconds)) * 1000;
  async function request(start, robots = false) {
    let url = start;
    for (let redirects = 0; redirects < 4; redirects++) {
      if (++requests > maxRequests) throw new Error('request_budget_exhausted');
      if (!canonicalUrl(url)) throw new Error('invalid_url');
      const host = new URL(url).hostname.replace(/[\[\]]/g, '');
      if (!dnsCache.has(host)) dnsCache.set(host, lookupPublic(host, { lookupHost, timeoutMs }).catch(error => { dnsCache.delete(host); throw error; }));
      const ips = await dnsCache.get(host);
      if (!ips.length || ips.some((a) => !publicAddress(a.address))) throw new Error('private_address_blocked');
      // Check the new origin after every cross-origin redirect, before sending the document request.
      if (!robots) await checkRobots(url);
      const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': UA, accept: 'text/html,application/rss+xml,application/atom+xml,application/xml,text/plain' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = canonicalUrl(response.headers.get('location'), url); if (!url) throw new Error('invalid_redirect'); continue; }
      if (robots && [404, 410].includes(response.status)) { await response.body?.cancel(); return { html: '', finalUrl: url, status: response.status }; }
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`HTTP_${response.status}`), { httpStatus: response.status, phase: robots ? 'robots' : 'page', httpsReached: url.startsWith('https:'), cloudflare: response.headers.get('cf-mitigated') === 'challenge' });
      }
      if (!/(text|html|xml|rss|atom)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('unsupported_content'); }
      if (Number(response.headers.get('content-length')) > 1500000) { await response.body?.cancel(); throw new Error('response_too_large'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 1500000) throw new Error('response_too_large'); chunks.push(chunk); }
      const html = Buffer.concat(chunks).toString('utf8');
      if (!robots && (/cf-chl-|challenge-platform/i.test(html) && /just a moment|verify you are human/i.test(html))) {
        throw Object.assign(new Error('cloudflare_challenge'), { httpStatus: response.status, phase: 'page', httpsReached: url.startsWith('https:'), cloudflare: true });
      }
      return { html, finalUrl: url, status: response.status };
    }
    throw new Error('redirect_limit');
  }
  async function checkRobots(url) {
    const origin = new URL(url).origin;
    const page = await getRobots(url);
    if (!robotsAllowed(page.html, url)) throw new Error('robots_blocked');
  }
  async function getRobots(url) {
    const origin = new URL(url).origin;
    if (!robotCache.has(origin)) robotCache.set(origin, request(`${origin}/robots.txt`, true).catch(error => { robotCache.delete(origin); throw error; }));
    return robotCache.get(origin);
  }
  const get = (url) => request(url);
  get.robots = getRobots;
  return get;
}
export function migrate(root) {
  const statePath = path.join(root, 'data/state.json');
  if (readJson(statePath, {}).schemaVersion === 2) return;
  const old = readJson(path.join(root, 'client/public/data/articles.json'), { items: [] });
  writeJson(path.join(root, 'data/legacy/articles.json'), old);
  writeJson(path.join(root, 'data/legacy/digest.json'), readJson(path.join(root, 'client/public/data/digest.json'), { digest: null }));
  for (const a of old.items || []) {
    const url = canonicalUrl(a.url); if (!url) continue;
    const id = articleId(url), file = path.join(root, `data/raw/${id}.json`); if (fs.existsSync(file)) continue;
    writeJson(file, { id, title: a.title, url, sourceKey: a.sourceKey || '', sourceName: a.sourceName || '', sourceType: a.sourceType || '', publishedAt: a.publishedAt || null, crawledAt: a.crawledAt || iso(), content: '', contentHash: sha256(''), contentStatus: 'needs_fetch', extractionMethod: 'legacy-title-only', discardReason: noiseReason(a.title, url), legacyId: a.id });
  }
  writeJson(statePath, { schemaVersion: 2, migratedAt: iso(), note: 'Legacy rules are archived, not accepted as AI analyses.' });
}
export function rawRecords(root) {
  const dir = path.join(root, 'data/raw'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((s) => /^[a-f0-9]{32}\.json$/.test(s)).sort().map((s) => readJson(path.join(dir, s)));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
export function validateAnalysis(a, raw) {
  assert(raw && ID.test(a.articleId) && a.articleId === raw.id, 'unknown_article');
  assert(HASH.test(a.contentHash) && a.contentHash === raw.contentHash, 'stale_content_hash');
  assert(['done', 'discarded', 'failed'].includes(a.analysisStatus), 'invalid_status');
  assert(asDate(a.analyzedAt) && Date.parse(a.analyzedAt) <= Date.now() + 600000, 'invalid_analysis_time');
  if (a.analysisStatus !== 'done') { assert(typeof a.failureReason === 'string' && a.failureReason.trim().length >= 4, 'missing_reason'); return; }
  assert(raw.contentStatus === 'ready' && raw.content.length >= 120 && !raw.discardReason, 'insufficient_source_content');
  assert(CATEGORIES.includes(a.category) && CONTENT_TYPES.includes(a.contentType), 'invalid_category_or_type');
  assert(Number.isInteger(a.score) && a.score >= 1 && a.score <= 5, 'invalid_score');
  assert(typeof a.summary === 'string' && a.summary.length >= 40 && a.summary.length <= 2500, 'invalid_summary');
  assert(typeof a.importanceReason === 'string' && a.importanceReason.length >= 10, 'missing_importance_reason');
  assert(Array.isArray(a.moatTags) && a.moatTags.every((s) => MOAT_TAGS.includes(s)), 'invalid_moat_tags');
  assert(Array.isArray(a.evidence) && a.evidence.length >= 1 && a.evidence.length <= 5, 'missing_evidence');
  for (const e of a.evidence) assert(canonicalUrl(e.url) === raw.url && typeof e.quote === 'string' && e.quote.length >= 12 && e.quote.length <= 200 && raw.content.includes(e.quote), 'evidence_not_in_source');
  assert(typeof a.limitations === 'string', 'missing_limitations');
}
export function publish(root) {
  migrate(root); const now = iso(), raws = rawRecords(root), byId = new Map(raws.map((r) => [r.id, r]));
  const analyses = new Map(), receipts = [], digests = [];
  const inbox = path.join(root, 'data/inbox');
  const files = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((s) => /^[\w.-]+\.json$/.test(s)).sort() : [];
  const validBatches = [];
  for (const file of files) {
    try {
      const b = readJson(path.join(inbox, file));
      assert(b.schemaVersion === 1 && b.generator === 'chatgpt-task' && asDate(b.createdAt) && Date.parse(b.createdAt) <= Date.now() + 600000, 'invalid_batch');
      assert(Array.isArray(b.analyses) && b.analyses.length <= 50, 'invalid_batch_size');
      const ids = new Set();
      for (const a of b.analyses) { assert(!ids.has(a.articleId), 'duplicate_article'); ids.add(a.articleId); validateAnalysis(a, byId.get(a.articleId)); }
      for (const a of b.analyses) if (!analyses.has(a.articleId) || Date.parse(a.analyzedAt) > Date.parse(analyses.get(a.articleId).analyzedAt)) analyses.set(a.articleId, { ...a, batchFile: `data/inbox/${file}` });
      validBatches.push({ file, batch: b });
      receipts.push({ file, status: 'accepted', analyses: b.analyses.length });
    } catch (error) { receipts.push({ file, status: 'rejected', reason: error.message }); }
  }
  for (const { file, batch } of validBatches) if (batch.digest) {
    try {
      const d = batch.digest;
      assert(/^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.timeZone === 'Asia/Shanghai', 'invalid_digest_date');
      assert(asDate(d.windowStart) && asDate(d.windowEnd) && asDate(d.generatedAt) && Date.parse(d.windowEnd) > Date.parse(d.windowStart) && Date.parse(d.generatedAt) <= Date.now() + 600000, 'invalid_digest_window');
      assert(d.windowStart === `${d.date}T00:00:00+08:00` && d.windowEnd === `${d.date}T23:59:59+08:00`, 'digest_must_cover_local_calendar_day');
      assert(Array.isArray(d.articleIds) && new Set(d.articleIds).size === d.articleIds.length, 'invalid_digest_ids');
      const included = d.articleIds.map((id) => { const a = analyses.get(id), r = byId.get(id); assert(a?.analysisStatus === 'done' && r, 'digest_uses_unverified_article'); const time = Date.parse(r.publishedAt || r.crawledAt); assert(time >= Date.parse(d.windowStart) && time <= Date.parse(d.windowEnd), 'article_outside_digest_window'); return r; });
      assert(typeof d.content === 'string' && d.content.length >= 20 && d.content.length <= 30000 && Number.isInteger(d.pendingCount) && d.pendingCount >= 0, 'invalid_digest_content');
      assert(included.every((r) => d.content.includes(r.url)), 'digest_missing_source_links');
      digests.push({ ...d, id: `daily-${d.date}`, articleCount: included.length, digestType: 'daily', generator: 'chatgpt-task', batchFile: file });
    } catch (error) { receipts.find((r) => r.file === file).digestError = error.message; }
  }
  const items = raws.map((r) => {
    const a = analyses.get(r.id);
    return { id: r.id, title: r.title, sourceKey: r.sourceKey, sourceName: r.sourceName, sourceType: r.sourceType, category: '', publishedAt: r.publishedAt, crawledAt: r.crawledAt, summary: '', score: 0, importanceReason: '', contentType: '', moatTags: [], url: r.url, analysisStatus: r.discardReason ? 'discarded' : 'pending', failureReason: r.discardReason || '', ...(a ? Object.fromEntries(['category', 'summary', 'score', 'importanceReason', 'contentType', 'moatTags', 'analysisStatus', 'failureReason', 'analyzedAt', 'evidence', 'limitations', 'batchFile'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) : {}) };
  }).sort((a, b) => Date.parse(b.crawledAt) - Date.parse(a.crawledAt));
  const pending = raws.filter((r) => !r.discardReason && !['done', 'discarded'].includes(analyses.get(r.id)?.analysisStatus));
  const ready = pending.filter((r) => r.contentStatus === 'ready').sort((a, b) => Date.parse(b.publishedAt || b.crawledAt) - Date.parse(a.publishedAt || a.crawledAt));
  const awaitingContent = pending.filter((r) => r.contentStatus !== 'ready');
  writeJson(path.join(root, 'data/queue.json'), { schemaVersion: 2, updatedAt: now, pendingCount: pending.length, readyCount: ready.length, awaitingContentCount: awaitingContent.length, items: [...ready, ...awaitingContent].map((r) => ({ id: r.id, title: r.title, url: r.url, publishedAt: r.publishedAt, crawledAt: r.crawledAt, contentStatus: r.contentStatus, contentHash: r.contentHash, rawPath: `data/raw/${r.id}.json`, lastAnalysisStatus: analyses.get(r.id)?.analysisStatus || 'pending' })) });
  const pub = (name, v) => writeJson(path.join(root, `client/public/data/${name}.json`), v);
  pub('articles', { items, updatedAt: now });
  const latestByDate = new Map();
  for (const d of digests.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt))) latestByDate.set(d.date, d);
  const history = [...latestByDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  pub('digest', { digest: history[0] || null });
  pub('digests', { items: history });
  pub('analysis-status', { updatedAt: now, pending: pending.length, ready: ready.length, awaitingContent: awaitingContent.length, done: items.filter((a) => a.analysisStatus === 'done').length, discarded: items.filter((a) => a.analysisStatus === 'discarded').length, rejectedBatches: receipts.filter((r) => r.status === 'rejected' || r.digestError).length, latestDigestDate: history[0]?.date || null, screenshotRulesConfirmed: false });
  writeJson(path.join(root, 'data/receipts.json'), { updatedAt: now, items: receipts });
  const runFile = path.join(root, 'client/public/data/runs.json'), existingRuns = readJson(runFile, { items: [] }).items;
  const runs = existingRuns.filter((r) => !r.id.startsWith('analysis:') && !r.id.startsWith('digest:'));
  for (const { file, batch } of validBatches) {
    if (batch.analyses.length) runs.push({ id: `analysis:${file}`, taskType: 'AI 分析', status: 'success', processed: batch.analyses.length, succeeded: batch.analyses.filter((a) => a.analysisStatus === 'done').length, failed: batch.analyses.filter((a) => a.analysisStatus === 'failed').length, detail: 'ChatGPT 提交，结构及来源摘录校验通过；不等于自动核实全部语义', failureReason: '', startedAt: batch.createdAt, finishedAt: batch.createdAt });
  }
  for (const d of history) runs.push({ id: `digest:${d.date}`, taskType: '每日摘要生成', status: 'success', processed: d.articleCount, succeeded: d.articleCount, failed: 0, detail: `ChatGPT 日报 ${d.date}；未处理 ${d.pendingCount}`, failureReason: '', startedAt: d.generatedAt, finishedAt: d.generatedAt });
  writeJson(runFile, { items: runs.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, 300), updatedAt: now });
  return { raw: raws.length, pending: pending.length, ready: ready.length, accepted: validBatches.length, rejected: receipts.filter((r) => r.status === 'rejected' || r.digestError).length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(publish(process.cwd()))); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

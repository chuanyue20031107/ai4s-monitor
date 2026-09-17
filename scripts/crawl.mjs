/** Bounded collector. Never assigns AI scores or writes the final digest. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { articleId, canonicalUrl, clean, extractContent, makeFetcher, migrate, noiseReason, rawRecords, readJson, sha256, writeJson, publish } from './pipeline.mjs';
import { sourceEntries, sourceEntry } from './source-content.mjs';
import { fetchWithRetry } from './source-retry.mjs';
import { failureType, repairDefaults } from './source-health-diagnose.mjs';

const now = () => new Date().toISOString();
const clamp = (n, min, max, fallback) => Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Math.floor(Number(n)))) : fallback;
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map((s) => s.replace(/^\uFEFF/, '').trim());
  return rows.filter((r) => r.some((s) => s.trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
function seedSources(root) {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const source = fs.readFileSync(path.join(root, 'client/src/data/ai4s-sources.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // This is trusted, checked-in TypeScript, never downloaded article content.
  vm.runInNewContext(`(function(module,exports){${js}\n})(module,module.exports)`, { module });
  const seeds = module.exports.SOURCE_SEED;
  const file = path.join(root, 'config/wechat_sources.csv');
  if (fs.existsSync(file)) {
    const base = String(process.env.WERSS_BASE_URL || '').trim();
    for (const row of parseCsv(fs.readFileSync(file, 'utf8'))) {
      if (!/^(1|true|yes)$/i.test(row.enabled?.trim())) continue;
      const id = row.source_key?.trim(); if (!id) continue;
      let fetchUrl = '';
      try { if (base && row.feed_id?.trim()) fetchUrl = canonicalUrl(`feed/${encodeURIComponent(row.feed_id.trim())}.xml`, `${base.replace(/\/$/, '')}/`) || ''; } catch { /* classified as needs_config below */ }
      seeds.push({ id, name: row.entity_name?.trim() || row.account_name?.trim(), group: row.group_name || '微信公众号', type: '微信公众号', region: '中国', directions: '微信公众号官方动态', products: '', representative: '', website: '', wechat: row.account_name || '', linkedin: '', github: '', feedUrl: '', priority: ({ S: '高', A: '中', B: '低' }[row.priority]) || '中', notes: 'WeRSS 地址仅在运行时读取，不公开到前端', _fetchUrl: fetchUrl, _wechat: true, enabled: true });
    }
  }
  return seeds;
}
export async function collect({ root = process.cwd(), seeds = null, fetchPage = null, wait, maxDurationMs = 20 * 60_000, batchSize = process.env.BATCH_SIZE || 36, maxPerSource = process.env.MAX_ARTICLES_PER_SOURCE || 3 } = {}) {
  const deadline = Date.now() + maxDurationMs;
  migrate(root);
  const pub = path.join(root, 'client/public/data');
  const settings = { dailyCrawlEnabled: true, concurrency: 3, timeoutSeconds: 15, retryCount: 1, ...readJson(path.join(pub, 'settings.json'), { settings: {} }).settings };
  if (settings.dailyCrawlEnabled === false && process.env.GITHUB_EVENT_NAME === 'schedule') return { skipped: 'dailyCrawlEnabled=false' };
  const saved = new Map((readJson(path.join(pub, 'sources.json'), { items: [] }).items || []).map((s) => [s.sourceKey, s]));
  const sources = (seeds || seedSources(root)).map((seed) => ({ ...seed, ...saved.get(seed.id), id: seed.id, sourceKey: seed.id, name: seed.name, groupName: seed.group, feedUrl: seed.feedUrl || '', website: seed.website || '', github: seed.github || '', _fetchUrl: seed._fetchUrl, _wechat: seed._wechat, enabled: saved.get(seed.id)?.enabled ?? seed.enabled ?? true, crawlStrategy: seed._wechat ? 'rss' : saved.get(seed.id)?.crawlStrategy || 'auto', crawlStatus: saved.get(seed.id)?.crawlStatus || 'idle' }));
  sources.forEach(s => Object.assign(s, repairDefaults(s)));
  const enabled = sources.filter((s) => s.enabled && s.crawlStrategy !== 'disabled').sort((a, b) => ({ 高: 0, 中: 1, 低: 2 }[a.priority] || 0) - ({ 高: 0, 中: 1, 低: 2 }[b.priority] || 0));
  const meta = readJson(path.join(pub, 'meta.json'), { cursor: 0 });
  const targets = enabled.length ? Array.from({ length: clamp(batchSize, 1, enabled.length, 36) }, (_, i) => enabled[((meta.cursor || 0) + i) % enabled.length]) : [];
  const fetcher = fetchPage || makeFetcher({ timeoutSeconds: settings.timeoutSeconds });
  const run = { id: randomUUID(), taskType: '来源抓取', status: 'running', processed: 0, succeeded: 0, failed: 0, inserted: 0, enriched: 0, detail: '', failureReason: '', startedAt: now(), finishedAt: null };
  const existing = new Map(rawRecords(root).map((r) => [r.url, r]));
  const claimed = new Set();
  let next = 0;
  const get = url => fetchWithRetry(fetcher, url, { wait, deadline });
  async function hydrate(entry, s, old = null) {
    if (claimed.has(entry.url)) return; claimed.add(entry.url);
    const contentFromFeed = entry.feedContent?.length >= 120;
    const record = { id: articleId(entry.url), title: entry.title, url: entry.url, sourceKey: s.sourceKey, sourceName: s.name, sourceType: s.type || '', publishedAt: entry.publishedAt || old?.publishedAt || null, crawledAt: old?.crawledAt || now(), content: '', contentStatus: 'needs_fetch', extractionMethod: '', discardReason: noiseReason(entry.title, entry.url), ...old };
    record.lastFetchAt = now();
    if (record.discardReason) return;
    try {
      let extracted;
      if (contentFromFeed) extracted = { content: entry.feedContent.slice(0, 5000), publishedAt: record.publishedAt, extractionMethod: 'feed-excerpt', contentTruncated: entry.feedContent.length >= 5000 };
      else {
        const page = await get(entry.url);
        extracted = extractContent(page.html);
        if (entry.fromSitemap) {
          record.title = clean(page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
            || page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
          if (record.title.length < 5 || record.title.length > 220 || noiseReason(record.title, entry.url)) return;
        }
      }
      record.content = extracted.content; record.extractionMethod = extracted.extractionMethod; record.contentTruncated = Boolean(extracted.contentTruncated);
      record.publishedAt ||= extracted.publishedAt;
      record.contentStatus = record.content.length >= 120 ? 'ready' : 'insufficient_content';
      record.contentError = record.contentStatus === 'ready' ? '' : '正文不足 120 字符，禁止仅凭标题宣布分析完成';
    } catch (error) {
      // A sitemap URL without an observed title/body is not an article record.
      if (entry.fromSitemap && !record.title) return;
      record.contentStatus = 'fetch_failed'; record.contentError = /^HTTP_\d+$|^(robots_blocked|request_budget_exhausted|private_address_blocked|unsupported_content|response_too_large)$/.test(error.message) ? error.message : 'fetch_error';
    }
    record.contentHash = sha256(record.content || '');
    writeJson(path.join(root, `data/raw/${record.id}.json`), record); existing.set(record.url, record);
    if (old) run.enriched++; else run.inserted++;
  }
  await Promise.all(Array.from({ length: Math.min(targets.length, clamp(settings.concurrency, 1, 4, 3)) }, async () => {
    while (next < targets.length) {
      const s = targets[next++]; s.lastCrawlAt = now(); s.lastCheckAt = s.lastCrawlAt;
      try {
        const url = sourceEntry(s);
        if (!url) throw new Error('needs_config');
        const page = await get(url), entries = await sourceEntries(page, get);
        const count = clamp(maxPerSource, 1, 8, 3); let used = 0;
        for (const entry of entries) {
          const old = existing.get(entry.url); if (old?.contentStatus === 'ready' || old?.discardReason) continue;
          if (used++ >= count) break;
          await hydrate(entry, s, old);
        }
        // Backfill previously discovered title-only records without requiring them to remain on the homepage.
        for (const old of existing.values()) {
          if (used >= count) break;
          if (old.sourceKey === s.sourceKey && old.contentStatus !== 'ready' && !old.discardReason && !claimed.has(old.url)) { used++; await hydrate(old, s, old); }
        }
        s.crawlStatus = entries.length ? 'ok' : 'no_content'; s.lastSuccessAt = now(); s.lastError = ''; s.lastDiagnostic = `发现 ${entries.length} 条候选；本次处理上限 ${count}；正文与分析状态分别记录`;
        s.failureType = ''; s.repairSuggestion = ''; s.autoRepairAvailable = false;
        run.succeeded++;
      } catch (error) {
        s.failureType = error.message === 'needs_config' ? 'needs_config' : failureType(error);
        s.crawlStatus = error.message === 'needs_config' ? 'needs_config' : error.message === 'robots_blocked' ? 'robots_blocked' : s.failureType === 'timeout' ? 'timeout' : 'network_error';
        s.lastError = s.failureType; s.autoRepairAvailable = false; s.repairSuggestion = 'diagnose_again';
        s.lastDiagnostic = s._wechat && !s._fetchUrl ? '需配置 WERSS_BASE_URL 和 feed_id' : `采集失败：${s.failureType}；网络/超时已按 30 秒、2 分钟重试，HTTP/robots 限制不重试；已进入失败来源队列。`; run.failed++;
      }
      run.processed++;
    }
  }));
  run.finishedAt = now(); run.status = run.failed ? 'failed' : 'success';
  run.detail = `来源 ${run.processed}：成功 ${run.succeeded}，失败 ${run.failed}；新增 ${run.inserted}，补正文 ${run.enriched}；未进行 AI 分析`;
  run.failureReason = run.failed ? '部分来源失败，已保留其他成功结果' : '';
  const safeSources = sources.map(({ _fetchUrl, _wechat, ...s }) => ({ ...s, ...(_wechat ? { feedUrl: '', discoveredFeedUrl: null } : {}) }));
  writeJson(path.join(pub, 'sources.json'), { items: safeSources, updatedAt: run.finishedAt });
  writeJson(path.join(pub, 'meta.json'), { ...meta, cursor: enabled.length ? ((meta.cursor || 0) + targets.length) % enabled.length : 0, updatedAt: run.finishedAt });
  writeJson(path.join(pub, 'runs.json'), { items: [run, ...(readJson(path.join(pub, 'runs.json'), { items: [] }).items || [])].slice(0, 300), updatedAt: run.finishedAt });
  // Never publish webhook URLs or model credentials in the public settings export.
  writeJson(path.join(pub, 'settings.json'), { settings: { ...settings, groupWebhookUrl: '', feishuReceivers: [], lastRunAt: run.finishedAt } });
  writeJson(path.join(pub, 'health.json'), { stats: { runId: run.id, status: run.status, running: false, total: sources.length, ok: sources.filter((s) => s.crawlStatus === 'ok').length, noContent: sources.filter((s) => s.crawlStatus === 'no_content').length, failed: sources.filter((s) => ['network_error', 'timeout', 'needs_config', 'robots_blocked'].includes(s.crawlStatus)).length, failureByType: [], lastCheckAt: run.finishedAt } });
  publish(root);
  return run;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log((await collect()).detail); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

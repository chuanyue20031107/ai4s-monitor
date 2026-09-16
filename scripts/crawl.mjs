import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'client', 'public', 'data');
const nowIso = () => new Date().toISOString();

function loadSourceSeed() {
  const input = fs.readFileSync(path.join(ROOT, 'client/src/data/ai4s-sources.ts'), 'utf8');
  const output = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module,exports,require){${output}\n})(module,module.exports,require);`, { module, require });
  return module.exports.SOURCE_SEED;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function loadWechatSourceSeed() {
  const configPath = path.join(ROOT, 'config', 'wechat_sources.csv');
  const baseUrlRaw = String(process.env.WERSS_BASE_URL || '').trim();
  if (!fs.existsSync(configPath) || !baseUrlRaw) return [];

  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    console.warn('WARN 微信 RSS 已跳过：WERSS_BASE_URL 不是有效 URL');
    return [];
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    console.warn('WARN 微信 RSS 已跳过：WERSS_BASE_URL 仅支持 http(s)');
    return [];
  }
  if (!baseUrl.href.endsWith('/')) baseUrl = new URL(`${baseUrl.href}/`);

  const priorityMap = { S: '高', A: '中', B: '低' };
  const rows = parseCsv(fs.readFileSync(configPath, 'utf8'));
  return rows
    .filter((row) => /^(1|true|yes)$/i.test(String(row.enabled || '').trim()) && String(row.feed_id || '').trim())
    .map((row) => {
      const feedId = String(row.feed_id).trim();
      return {
        id: String(row.source_key).trim(),
        name: String(row.entity_name).trim() || String(row.account_name).trim(),
        group: String(row.group_name).trim() || '微信公众号',
        type: '微信公众号',
        region: '中国',
        directions: '微信公众号官方动态',
        products: '',
        representative: '',
        website: '',
        wechat: String(row.account_name).trim(),
        linkedin: '',
        github: '',
        feedUrl: new URL(`feed/${encodeURIComponent(feedId)}.xml`, baseUrl).href,
        priority: priorityMap[String(row.priority).trim()] || '中',
        notes: 'WeRSS 自动抓取来源',
        enabled: true,
        crawlStrategy: 'rss',
      };
    });
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return fallback; }
}

function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

const defaults = {
  dailyCrawlEnabled: true,
  dailyPushEnabled: false,
  pushTime: '18:00',
  feishuReceivers: [],
  groupWebhookUrl: '',
  weeklyReportEnabled: true,
  weeklyReportDay: 'fri',
  concurrency: 6,
  retryCount: 1,
  timeoutSeconds: 20,
  minScore: 3,
  focusCategories: ['模型', '数据', 'AI4S 应用', '自动化实验室', '产业与商业', '其他'],
  retentionDays: 90,
  crawlWindowStart: '00:00',
  crawlWindowEnd: '23:59',
  lastRunAt: null,
};

function sourceRow(item) {
  return {
    id: item.id,
    sourceKey: item.id,
    name: item.name,
    groupName: item.group,
    type: item.type,
    region: item.region,
    directions: item.directions,
    products: item.products,
    representative: item.representative,
    website: item.website,
    wechat: item.wechat,
    linkedin: item.linkedin,
    github: item.github,
    feedUrl: item.feedUrl,
    priority: item.priority,
    notes: item.notes,
    enabled: item.enabled ?? true,
    crawlStrategy: item.crawlStrategy ?? 'auto',
    discoveredFeedUrl: null,
    crawlStatus: 'idle',
    lastCrawlAt: null,
    lastSuccessAt: null,
    lastDiagnostic: null,
    lastCheckAt: null,
    lastError: '',
  };
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function stripTags(value) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function absoluteUrl(base, href) {
  try {
    const value = new URL(href, base);
    if (!['http:', 'https:'].includes(value.protocol)) return null;
    value.hash = '';
    for (const key of [...value.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) value.searchParams.delete(key);
    }
    return value.toString();
  } catch { return null; }
}

function extractDate(block) {
  const raw = stripTags((block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function extractEntries(html, pageUrl) {
  const items = [];
  const seen = new Set();
  const add = (title, href, publishedAt = null) => {
    const url = absoluteUrl(pageUrl, href);
    title = stripTags(title);
    if (!url || !title || title.length < 5 || title.length > 220 || seen.has(url)) return;
    seen.add(url);
    items.push({ title, url, publishedAt });
  };
  for (const match of html.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = match[0];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const href = (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]
      || stripTags((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    add(title, href, extractDate(block));
    if (items.length >= 16) return items;
  }
  const likely = /(news|blog|research|article|press|publication|paper|event|conference|insight|story|202[4-9])/i;
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = stripTags(match[2]);
    const href = match[1];
    if (!likely.test(href) && !likely.test(title)) continue;
    add(title, href);
    if (items.length >= 16) break;
  }
  if (!items.length) {
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    add(title, pageUrl);
  }
  return items;
}

function classify(title, source) {
  const text = `${title} ${source.directions} ${source.type}`.toLowerCase();
  if (/(robot|automation|laboratory|实验|仪器|robotic|screening)/i.test(text)) return '自动化实验室';
  if (/(dataset|database|data |数据|benchmark|fair)/i.test(text)) return '数据';
  if (/(funding|partnership|acqui|company|market|融资|合作|产业|商业|采购)/i.test(text)) return '产业与商业';
  if (/(model|llm|foundation|模型|algorithm|agent)/i.test(text)) return '模型';
  if (/(drug|protein|material|chem|bio|science|药物|蛋白|材料|科研|科学)/i.test(text)) return 'AI4S 应用';
  return '其他';
}

function score(title, source) {
  let value = source.priority === '高' ? 4 : source.priority === '中' ? 3 : 2;
  if (/(launch|release|breakthrough|funding|partnership|new model|发布|突破|融资|合作)/i.test(title)) value += 1;
  return Math.min(5, value);
}

async function fetchPage(url, timeoutSeconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'user-agent': 'AI4S-Monitor/1.0 (+https://github.com/chuanyue20031107/ai4s-monitor)',
        accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/(html|xml|rss|atom|text)/i.test(contentType)) throw new Error(`Unsupported content type: ${contentType}`);
    return { html: await response.text(), finalUrl: response.url || url };
  } finally { clearTimeout(timer); }
}

async function withRetry(task, count) {
  let last;
  for (let attempt = 0; attempt <= count; attempt += 1) {
    try { return await task(); } catch (error) { last = error; }
  }
  throw last;
}

const seed = [...loadSourceSeed(), ...loadWechatSourceSeed()];
const savedSources = readJson('sources.json', { items: [] }).items || [];
const sourceState = new Map(savedSources.map((item) => [item.sourceKey, item]));
const sources = seed.map((item) => ({ ...sourceRow(item), ...(sourceState.get(item.id) || {}) }));
const articles = readJson('articles.json', { items: [] }).items || [];
const runs = readJson('runs.json', { items: [] }).items || [];
const settings = { ...defaults, ...(readJson('settings.json', { settings: {} }).settings || {}) };
const meta = readJson('meta.json', { cursor: 0 });

const enabled = sources.filter((item) => item.enabled).sort((a, b) => ({ 高: 0, 中: 1, 低: 2 }[a.priority] - ({ 高: 0, 中: 1, 低: 2 }[b.priority])));
const requestedBatch = Number(process.env.BATCH_SIZE || 36);
const batchSize = Math.max(1, Math.min(enabled.length, requestedBatch));
const targets = Array.from({ length: batchSize }, (_, index) => enabled[(meta.cursor + index) % enabled.length]);
const run = {
  id: randomUUID(), taskType: '来源抓取', status: 'running', processed: 0, succeeded: 0, failed: 0,
  detail: `GitHub Actions 抓取已启动：${targets.length} 个来源`, failureReason: '', startedAt: nowIso(), finishedAt: null,
};
runs.unshift(run);
const knownUrls = new Set(articles.map((item) => item.url));

async function crawl(source) {
  const url = source.feedUrl || source.website || source.github;
  source.lastCrawlAt = nowIso();
  source.lastCheckAt = source.lastCrawlAt;
  if (!url) throw new Error('未配置可抓取地址');
  const page = await withRetry(() => fetchPage(url, settings.timeoutSeconds), settings.retryCount);
  const entries = extractEntries(page.html, page.finalUrl);
  let inserted = 0;
  for (const entry of entries) {
    if (knownUrls.has(entry.url)) continue;
    knownUrls.add(entry.url);
    const id = createHash('sha256').update(entry.url).digest('hex').slice(0, 32);
    articles.unshift({
      id, title: entry.title, sourceKey: source.sourceKey, sourceName: source.name, sourceType: source.type,
      category: classify(entry.title, source), publishedAt: entry.publishedAt, crawledAt: nowIso(),
      summary: `GitHub Actions 自动抓取自 ${source.name}：${entry.title}`,
      score: score(entry.title, source), importanceReason: '根据来源优先级与标题关键词规则评分',
      contentType: 'media_report', moatTags: [], url: entry.url, analysisStatus: 'done', failureReason: '',
    });
    inserted += 1;
  }
  source.crawlStatus = entries.length ? 'ok' : 'no_content';
  source.lastSuccessAt = nowIso();
  source.lastDiagnostic = `解析 ${entries.length} 条候选内容，新增 ${inserted} 条`;
  source.lastError = '';
  return inserted;
}

let next = 0;
const workers = Array.from({ length: Math.max(1, Math.min(8, settings.concurrency)) }, async () => {
  while (next < targets.length) {
    const source = targets[next++];
    try {
      const inserted = await crawl(source);
      run.succeeded += 1;
      console.log(`OK ${source.name}: +${inserted}`);
    } catch (error) {
      source.crawlStatus = error?.name === 'AbortError' ? 'timeout' : 'network_error';
      source.lastError = error instanceof Error ? error.message : String(error);
      source.lastDiagnostic = `抓取失败：${source.lastError}`;
      run.failed += 1;
      console.warn(`FAIL ${source.name}: ${source.lastError}`);
    }
    run.processed += 1;
  }
});

await Promise.all(workers);
run.status = run.succeeded ? 'success' : 'failed';
run.finishedAt = nowIso();
run.detail = `完成 ${run.processed}/${targets.length}：成功 ${run.succeeded}，失败 ${run.failed}`;
settings.lastRunAt = run.finishedAt;
meta.cursor = (meta.cursor + targets.length) % Math.max(1, enabled.length);
meta.updatedAt = run.finishedAt;

const cutoff = Date.now() - settings.retentionDays * 86400000;
const retained = articles.filter((item) => new Date(item.crawledAt).getTime() >= cutoff).slice(0, 3000);
const recent = retained.filter((item) => Date.now() - new Date(item.crawledAt).getTime() < 86400000).slice(0, 30);
const digestContent = recent.length
  ? ['【重点情报】', ...recent.filter((item) => item.score >= settings.minScore).map((item) => `来源：${item.sourceName}\n评分：${item.score}/5\n摘要：${item.title}\n原文链接：${item.url}`), '', '【趋势观察】', `过去 24 小时共抓取 ${recent.length} 条 AI4S 情报。`].join('\n\n')
  : '';

writeJson('articles.json', { items: retained, updatedAt: run.finishedAt });
writeJson('sources.json', { items: sources, updatedAt: run.finishedAt });
writeJson('runs.json', { items: runs.slice(0, 200), updatedAt: run.finishedAt });
writeJson('settings.json', { settings });
writeJson('digest.json', { digest: digestContent ? { id: run.id, content: digestContent, articleCount: recent.length, generatedAt: run.finishedAt, digestType: 'daily' } : null });
writeJson('weekly-digest.json', { digest: null });
writeJson('health.json', { stats: { runId: run.id, status: run.status, running: false, total: sources.length, ok: sources.filter((item) => item.crawlStatus === 'ok').length, noContent: sources.filter((item) => item.crawlStatus === 'no_content').length, failed: sources.filter((item) => ['network_error', 'timeout', 'failed'].includes(item.crawlStatus)).length, failureByType: [], lastCheckAt: run.finishedAt } });
writeJson('meta.json', meta);
console.log(run.detail);

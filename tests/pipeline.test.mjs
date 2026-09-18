import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalUrl, clean, extractEntries, extractContent, noiseReason, publicAddress, robotsAllowed, sha256, articleId, migrate, publish, readJson, writeJson, validateAnalysis } from '../scripts/pipeline.mjs';
import { collect, parseCsv } from '../scripts/crawl.mjs';
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai4s-test-'));
const stamp = '2026-09-15T12:00:00Z';
const content = 'Researchers released a new open dataset for protein design. The dataset includes measured experimental outcomes, evaluation splits and provenance. The paper reports results on a held-out test set, but independent replication is not yet available.';
const raw = () => ({ id: articleId('https://example.org/news/protein'), title: 'New protein design dataset', url: 'https://example.org/news/protein', sourceKey: 's1', sourceName: 'Example research lab', sourceType: 'research', publishedAt: stamp, crawledAt: stamp, content, contentHash: sha256(content), contentStatus: 'ready', discardReason: '' });
const analysis = (r) => ({ articleId: r.id, contentHash: r.contentHash, analysisStatus: 'done', analyzedAt: stamp, category: '数据', summary: '研究团队公开了一套面向蛋白质设计的数据集，包含实验结果、评估划分及来源信息。论文报告了留出测试集结果，但原始材料明确说明尚无独立复现。', score: 3, importanceReason: '数据与来源信息有助于评估，但独立复现和规模信息仍不足。', contentType: 'paper_result', moatTags: ['数据'], evidence: [{ url: r.url, quote: 'Researchers released a new open dataset for protein design.' }], limitations: '只有原文摘录，数据规模未提供。' });
const batch = (r) => ({ schemaVersion: 1, generator: 'chatgpt-task', createdAt: stamp, analyses: [analysis(r)] });
function putRaw(root, r) { writeJson(path.join(root, `data/raw/${r.id}.json`), r); }
function inbox(root, b, name = 'test.json') { writeJson(path.join(root, `data/inbox/${name}`), b); }

test('canonical URLs remove tracking, preserve business identifiers, block credentials and local networks', () => {
  assert.equal(canonicalUrl('/paper?id=3&utm_source=x#foo', 'https://example.org/'), 'https://example.org/paper?id=3');
  for (const u of ['javascript:alert(1)', 'https://user:pass@example.org', 'http://127.0.0.1', 'https://example.org/?token=secret']) assert.equal(canonicalUrl(u), null);
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false);
});
test('RSS/Atom capture evidence and do not create a homepage fallback', () => {
  const entries = extractEntries(`<rss><item><title><![CDATA[New protein model]]></title><link>https://example.org/news/a</link><pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>${content}</p>]]></description></item></rss>`, 'https://example.org/feed');
  assert.equal(entries.length, 1); assert.equal(entries[0].feedContent, content); assert.equal(entries[0].publishedAt, new Date(stamp).toISOString());
  assert.equal(extractEntries('<html><title>Welcome to university</title></html>', 'https://example.org/').length, 0);
  const atom = extractEntries('<feed><entry><title>Protein model launch</title><link rel="self" href="https://example.org/api"/><link rel="alternate" href="https://example.org/news/a"/><summary>Evidence</summary></entry></feed>', 'https://example.org/');
  assert.equal(atom[0].url, 'https://example.org/news/a');
});
test('navigation and campus notifications are excluded, article content is separate', () => {
  assert.ok(noiseReason('关于校园喷药作业的通知')); assert.ok(noiseReason('后勤保障中心'));
  assert.equal(noiseReason('New protein design dataset'), '');
  assert.equal(extractContent(`<nav>Menu</nav><article><p>${content}</p></article>`).content, content);
  assert.equal(clean('&#x41; &amp; &#999999999;'), 'A &');
});
test('robots disallow, allow exceptions and specific agents are respected', () => {
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /private', 'https://example.org/private/a'), false);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /\nAllow: /news', 'https://example.org/news/a'), true);
  assert.equal(robotsAllowed('User-agent: *\nAllow: /\nUser-agent: AI4S-Monitor\nDisallow: /', 'https://example.org/news'), false);
});
test('CSV supports quoted commas, quotes and embedded newlines', () => {
  const rows = parseCsv('id,name,note\n1,"Lab, A","two\nlines"\n2,"A ""quoted"" name",ok\n');
  assert.equal(rows[0].name, 'Lab, A'); assert.equal(rows[0].note, 'two\nlines'); assert.equal(rows[1].name, 'A "quoted" name');
});
test('legacy done flags and rule digests are archived, never treated as model output', () => {
  const root = fixture(), r = raw();
  writeJson(path.join(root, 'client/public/data/articles.json'), { items: [{ ...r, analysisStatus: 'done', score: 5 }] });
  writeJson(path.join(root, 'client/public/data/digest.json'), { digest: { content: 'fake rules' } });
  publish(root);
  assert.equal(readJson(path.join(root, 'client/public/data/articles.json')).items.length, 0);
  assert.equal(readJson(path.join(root, 'client/public/data/digest.json')).digest, null);
  assert.equal(readJson(path.join(root, 'data/legacy/digest.json')).digest.content, 'fake rules');
  migrate(root); assert.equal(fs.readdirSync(path.join(root, 'data/raw')).length, 1);
  fs.rmSync(root, { recursive: true });
});
test('content hashes, evidence, score and available body are required for done', () => {
  const r = raw(), a = analysis(r); assert.doesNotThrow(() => validateAnalysis(a, r));
  assert.throws(() => validateAnalysis({ ...a, contentHash: sha256('wrong') }, r), /stale/);
  assert.throws(() => validateAnalysis({ ...a, evidence: [{ url: r.url, quote: 'This was never in the article.' }] }, r), /evidence/);
  assert.throws(() => validateAnalysis({ ...a, score: 8 }, r), /score/);
  assert.throws(() => validateAnalysis(a, { ...r, contentStatus: 'needs_fetch' }), /excluded_source_content/);
});
test('records without usable正文 are excluded from queue and Pages data', () => {
  const root = fixture(), r = raw(); migrate(root); putRaw(root, r);
  const missing = { ...r, id: articleId('https://example.org/news/missing'), url: 'https://example.org/news/missing', content: '标题导航', contentHash: sha256('标题导航'), contentStatus: 'insufficient_content' };
  putRaw(root, missing); publish(root);
  const articles = readJson(path.join(root, 'client/public/data/articles.json')).items;
  const queue = readJson(path.join(root, 'data/queue.json'));
  assert.equal(articles.some((a) => a.id === missing.id), false);
  assert.equal(queue.items.some((a) => a.id === missing.id), false);
  assert.equal(queue.excludedContentCount, 1);
  assert.equal(readJson(path.join(root, 'client/public/data/analysis-status.json')).awaitingContent, 0);
  fs.rmSync(root, { recursive: true });
});
test('malformed batches are rejected and valid analyses remain published', () => {
  const root = fixture(), r = raw(); migrate(root); putRaw(root, r); inbox(root, batch(r));
  inbox(root, { ...batch(r), analyses: [{ ...analysis(r), contentHash: sha256('bad') }] }, 'bad.json');
  const result = publish(root); assert.equal(result.accepted, 1); assert.equal(result.rejected, 1);
  assert.equal(readJson(path.join(root, 'client/public/data/articles.json')).items[0].analysisStatus, 'done');
  assert.equal(readJson(path.join(root, 'data/queue.json')).readyCount, 0);
  assert.equal(readJson(path.join(root, 'client/public/data/articles.json')).items[0].content, undefined);
  fs.rmSync(root, { recursive: true });
});
test('date archives require reviewed in-window items and links; invalid newer digest does not replace valid one', () => {
  const root = fixture(), r = raw(); migrate(root); putRaw(root, r);
  const d = { date: '2026-09-15', timeZone: 'Asia/Shanghai', windowStart: '2026-09-15T00:00:00+08:00', windowEnd: '2026-09-15T23:59:59+08:00', generatedAt: stamp, articleIds: [r.id], pendingCount: 0, content: `【重点情报】研究团队发布蛋白质设计数据集；独立复现尚缺。原文：${r.url}` };
  inbox(root, { ...batch(r), digest: d }); publish(root);
  inbox(root, { ...batch(r), analyses: [], digest: { ...d, content: '没有原文链接的摘要不能覆盖已有的正确日报。' } }, 'new-invalid.json');
  publish(root);
  assert.equal(readJson(path.join(root, 'client/public/data/digest.json')).digest.content, d.content);
  assert.equal(readJson(path.join(root, 'client/public/data/digests.json')).items.length, 1);
  fs.rmSync(root, { recursive: true });
});
test('collector is idempotent, saves raw content, and never claims AI completion', async () => {
  const root = fixture(); let requests = 0;
  const seeds = [{ id: 's1', name: 'Lab', type: 'research', group: 'test', priority: '高', feedUrl: 'https://example.org/feed' }];
  const fetchPage = async (url) => { requests++; return { finalUrl: url, html: `<rss><item><title>New protein design dataset</title><link>https://example.org/news/protein</link><description>${content}</description></item></rss>` }; };
  await collect({ root, seeds, fetchPage }); await collect({ root, seeds, fetchPage });
  const raws = fs.readdirSync(path.join(root, 'data/raw')); assert.equal(raws.length, 1);
  const articles = readJson(path.join(root, 'client/public/data/articles.json')).items;
  assert.equal(articles[0].analysisStatus, 'pending'); assert.equal(articles[0].summary, '');
  assert.equal(readJson(path.join(root, 'data/queue.json')).readyCount, 1); assert.equal(requests, 2);
  fs.rmSync(root, { recursive: true });
});
test('zero enabled sources exits normally, unsupported WeRSS is marked needs_config', async () => {
  const root = fixture(); assert.equal((await collect({ root, seeds: [] })).processed, 0);
  const r = await collect({ root, seeds: [{ id: 'wx1', name: 'Wechat', type: '微信公众号', enabled: true, _wechat: true, _fetchUrl: '' }] });
  assert.equal(r.failed, 1); assert.equal(readJson(path.join(root, 'client/public/data/sources.json')).items[0].crawlStatus, 'needs_config');
  fs.rmSync(root, { recursive: true });
});


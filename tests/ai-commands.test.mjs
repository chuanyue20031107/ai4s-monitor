import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { articleId, sha256, writeJson, readJson, publish } from '../scripts/pipeline.mjs';
import { runWorker } from '../scripts/ai-analysis-worker.mjs';
import { validateCommand } from '../scripts/ai-commands-core.mjs';

const content = 'Researchers released a new open dataset for protein design. The dataset includes experimental outcomes, evaluation splits and provenance. Independent replication is not yet available.';
const stamp = '2026-09-15T00:00:00Z';
function fixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai4s-command-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('ai4s-command-test-'));
    fs.rmSync(root, { recursive: true });
  });
  const raws = Array.from({ length: count }, (_, i) => {
    const url = `https://example.org/news/${i}`;
    const r = { id: articleId(url), title: `Protein dataset ${i}`, url, sourceName: 'Research lab', sourceKey: 's1',
      crawledAt: stamp, publishedAt: stamp, content, contentHash: sha256(content), contentStatus: 'ready', discardReason: '' };
    writeJson(path.join(root, `data/raw/${r.id}.json`), r); return r;
  });
  return { root, raws };
}
function command(root, id = 'command-0001', limit = 100, query = '') {
  const c = { schemaVersion: 1, id, type: 'analyze', limit, instruction: '依据原文分析', query, createdAt: stamp };
  writeJson(path.join(root, `data/ai-commands/pending/${id}.json`), c); return c;
}
const snapshot = (root) => readJson(path.join(root, 'client/public/data/ai-commands.json'));
const tasks = (root) => fs.readdirSync(path.join(root, 'data/ai-commands/tasks')).map((f) => readJson(path.join(root, 'data/ai-commands/tasks', f)));
function inbox(root, r, extra = {}) {
  const at = new Date(Date.now() + 1000).toISOString();
  const analysis = { articleId: r.id, contentHash: r.contentHash, analysisStatus: 'done', analyzedAt: at,
    category: '数据', summary: '研究团队公开面向蛋白质设计的数据集，记录实验结果、评估划分与来源信息；原始摘录未提供独立复现证据，不能据此确定实际改进幅度。',
    score: 3, importanceReason: '有可追溯的数据集信息，但缺乏独立验证与完整指标。', contentType: 'paper_result',
    moatTags: ['数据'], evidence: [{ url: r.url, quote: 'Researchers released a new open dataset for protein design.' }],
    limitations: '仅依据原文摘录。', ...extra };
  writeJson(path.join(root, 'data/inbox/result.json'), { schemaVersion: 1, generator: 'chatgpt-task', createdAt: at, analyses: [analysis] });
}

for (const limit of [100, 500, 'all']) test(`clearance ${limit} selects its bound and splits into <=30-item tasks`, (t) => {
  const { root } = fixture(t, 517); command(root, 'command-0001', limit); runWorker(root);
  const selected = limit === 'all' ? 517 : limit;
  const result = snapshot(root).items[0];
  assert.equal(result.total, selected);
  assert.equal(result.pending, selected);
  assert.equal(result.status, 'awaiting_analysis');
  assert.equal(result.remaining, 517 - selected);
  assert.equal(tasks(root).length, Math.ceil(selected / 30));
  assert.ok(tasks(root).every((x) => x.items.length <= 30));
  const articles = readJson(path.join(root, 'client/public/data/articles.json')).items;
  assert.equal(articles.filter((a) => a.analysisStatus === 'analyzing').length, selected);
  assert.ok(articles.every((a) => a.score === 0 && a.summary === ''));
});

test('reruns, overlapping requests and workflow dispatch retries never duplicate work', (t) => {
  const { root } = fixture(t, 150);
  runWorker(root, { limit: '100', requestId: 'dispatch-123456' });
  const before = tasks(root);
  runWorker(root, { limit: '100', requestId: 'dispatch-123456' });
  assert.deepEqual(tasks(root), before);
  command(root, 'command-0002', 100); runWorker(root);
  assert.equal(snapshot(root).items.find((r) => r.id === 'command-0002').alreadyQueued, 100);
  const ids = tasks(root).flatMap((x) => x.items.map((a) => a.id));
  assert.equal(ids.length, 150); assert.equal(new Set(ids).size, 150);
});

test('missing body, previously completed and discarded records cannot be assigned', (t) => {
  const { root, raws } = fixture(t, 3);
  const missing = { ...raws[0], contentStatus: 'needs_fetch', content: '' };
  writeJson(path.join(root, `data/raw/${missing.id}.json`), missing);
  writeJson(path.join(root, `data/raw/${raws[1].id}.json`), { ...raws[1], discardReason: '导航页' });
  inbox(root, raws[2]); command(root); runWorker(root);
  assert.equal(snapshot(root).items[0].total, 0);
  assert.equal(snapshot(root).items[0].blocked, 1);
  assert.equal(snapshot(root).items[0].status, 'no_work');
});

test('ordinary publish sees requests but only the worker admits them', (t) => {
  const { root } = fixture(t); command(root); publish(root);
  assert.equal(snapshot(root).items[0].status, 'pending');
  assert.equal(readJson(path.join(root, 'client/public/data/articles.json')).items[0].analysisStatus, 'pending');
});

test('validated ChatGPT inbox results complete tasks during normal publication', (t) => {
  const { root, raws } = fixture(t); command(root); runWorker(root);
  inbox(root, raws[0]); publish(root);
  assert.equal(snapshot(root).items[0].status, 'completed');
  assert.equal(snapshot(root).items[0].completed, 1);
  assert.equal(snapshot(root).pendingTasks, 0);
  assert.equal(readJson(path.join(root, 'client/public/data/articles.json')).items[0].analysisStatus, 'done');
});

test('invalid evidence cannot mark tasks or articles done', (t) => {
  const { root, raws } = fixture(t); command(root); runWorker(root);
  inbox(root, raws[0], { evidence: [{ url: raws[0].url, quote: 'Fabricated evidence that never existed.' }] });
  const result = publish(root);
  assert.equal(result.rejected, 1);
  assert.equal(snapshot(root).items[0].pending, 1);
  assert.equal(snapshot(root).items[0].completed, 0);
});

test('accepted failures release reservations and a new command can retry them', (t) => {
  const { root, raws } = fixture(t); command(root); runWorker(root);
  inbox(root, raws[0], { analysisStatus: 'failed', failureReason: '分析任务暂时失败' }); publish(root);
  assert.equal(snapshot(root).items[0].status, 'partial');
  // Even a slightly future-dated accepted failure must not immediately fail the new attempt.
  command(root, 'command-0002'); runWorker(root);
  assert.equal(snapshot(root).items.find((x) => x.id === 'command-0002').total, 1);
  assert.equal(snapshot(root).items.find((x) => x.id === 'command-0002').pending, 1);
});

test('changed source hashes invalidate old tasks and allow fresh analysis', (t) => {
  const { root, raws } = fixture(t); command(root); runWorker(root);
  const r = { ...raws[0], content: `${content} Updated.`, contentHash: sha256(`${content} Updated.`) };
  writeJson(path.join(root, `data/raw/${r.id}.json`), r); publish(root);
  assert.equal(snapshot(root).items[0].failed, 1);
  command(root, 'command-0002'); runWorker(root);
  assert.equal(snapshot(root).items.find((x) => x.id === 'command-0002').total, 1);
});

test('keyword scope is literal; shell-like instructions are stored as data only', (t) => {
  const { root } = fixture(t, 3);
  const c = command(root, 'command-0001', 100, 'dataset 1');
  c.instruction = '分析; $(echo SHOULD_NOT_RUN)';
  writeJson(path.join(root, 'data/ai-commands/pending/command-0001.json'), c);
  runWorker(root);
  assert.equal(snapshot(root).items[0].total, 1);
  assert.equal(tasks(root)[0].instruction, c.instruction);
});

test('malformed and edited commands are rejected without blocking valid siblings', (t) => {
  const { root } = fixture(t);
  const c = command(root); command(root, 'command-0002');
  fs.writeFileSync(path.join(root, 'data/ai-commands/pending/broken-0001.json'), '{');
  runWorker(root);
  assert.equal(snapshot(root).items.find((x) => x.id === c.id).total, 1);
  assert.equal(snapshot(root).items.find((x) => x.id === 'broken-0001').status, 'rejected');
  const before = tasks(root);
  writeJson(path.join(root, 'data/ai-commands/pending/command-0001.json'), { ...c, limit: 'all' });
  runWorker(root);
  assert.equal(snapshot(root).items.find((x) => x.id === c.id).reason, 'command_changed_create_new_id');
  assert.deepEqual(tasks(root), before);
  for (const change of [{ id: '../escape' }, { limit: 5 }, { limit: '100' }, { instruction: '' }, { rawPath: '/tmp/program' }]) {
    assert.throws(() => validateCommand({ ...c, ...change }, 'command-0001.json'));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backfillTargets } from '../scripts/backfill-targets.mjs';
import { articleId, sha256, readJson, writeJson } from '../scripts/pipeline.mjs';

test('historical IDs are visited once across resumptions, including failures and off-homepage URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai4s-backfill-'));
  const urls = ['https://example.org/old/1','https://example.org/old/2','https://example.org/old/3'];
  const manifest = { items: urls.map(url => ({ id: articleId(url) })) };
  urls.forEach(url => writeJson(path.join(root, `data/raw/${articleId(url)}.json`), { id: articleId(url), url, content: '', contentHash: sha256(''), contentStatus: 'needs_fetch' }));
  const body = 'Public experimental report with methods and measured outcomes. '.repeat(4);
  const calls = [], checkpointPath = path.join(root, 'checkpoint.json');
  const fetchPage = async url => { calls.push(url); if (url === urls[0]) throw new Error('robots_blocked'); return { html: `<article>${body}</article>`, finalUrl: url }; };
  await backfillTargets({ root, manifest, checkpointPath, fetchPage, limit: 2 });
  await backfillTargets({ root, manifest, checkpointPath, fetchPage, limit: 2 });
  assert.deepEqual(calls, urls);
  const raw = readJson(path.join(root, `data/raw/${articleId(urls[2])}.json`));
  assert.equal(raw.contentHash, sha256(raw.content)); assert.equal(raw.contentStatus, 'ready');
  assert.equal(readJson(checkpointPath).items[articleId(urls[0])].error, 'robots_blocked');
  assert.equal(fs.existsSync(path.join(root, 'data/queue.json')), false);
  await assert.rejects(backfillTargets({ root, manifest: { items: manifest.items.slice(1) }, checkpointPath, fetchPage }), /frozen_target_mismatch/);
  fs.rmSync(root, { recursive: true });
});

test('ready evidence is preserved unless explicitly selected for re-fetch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai4s-backfill-'));
  const url = 'https://example.org/old', id = articleId(url), content = 'Stored article body. '.repeat(10);
  writeJson(path.join(root, `data/raw/${id}.json`), { id, url, content, contentHash: sha256(content), contentStatus: 'ready' });
  let calls = 0;
  await backfillTargets({ root, manifest: { items: [{id}] }, checkpointPath: path.join(root, 'checkpoint.json'), fetchPage: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(readJson(path.join(root, `data/raw/${id}.json`)).content, content);
  fs.rmSync(root, { recursive: true });
});

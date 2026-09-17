/** Bounded historical URL hydration. No discovery, analysis or derived status writes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractContent, makeFetcher, readJson, sha256, writeJson } from './pipeline.mjs';
import { fetchWithRetry } from './source-retry.mjs';

export async function backfillTargets({ root = process.cwd(), manifest, checkpointPath, fetchPage,
  limit = 40, concurrency = 3, maxDurationMs = 20 * 60_000, wait } = {}) {
  if (!manifest?.items?.length || !checkpointPath) throw new Error('manifest_and_checkpoint_required');
  const ids = [...new Set(manifest.items.map(x => x.id))];
  if (ids.some(id => !/^[a-f0-9]{32}$/.test(id))) throw new Error('invalid_target_id');
  const fingerprint = sha256(ids.join('\n'));
  const state = readJson(checkpointPath, { schemaVersion: 1, fingerprint, items: {} });
  if (state.fingerprint !== fingerprint) throw new Error('frozen_target_mismatch');
  const get = fetchPage || makeFetcher({ maxRequests: 180, timeoutSeconds: 15 });
  const deadline = Date.now() + maxDurationMs;
  const targets = ids.filter(id => !state.items[id]?.finishedAt).slice(0, Math.max(1, Math.min(60, limit)));
  const busy = new Set(); let completed = 0;
  async function hydrate(id) {
    const file = path.join(root, `data/raw/${id}.json`), old = readJson(file, null);
    const startedAt = new Date().toISOString();
    if (!old) { state.items[id] = { startedAt, finishedAt: startedAt, status: 'missing_raw' }; return; }
    // Explicit re-fetch IDs can include a ready record whose body was reviewed as unusable.
    if (old.contentStatus === 'ready' && !manifest.items.find(x => x.id === id)?.refetch) {
      state.items[id] = { startedAt, finishedAt: startedAt, status: 'already_ready', contentHash: old.contentHash }; return;
    }
    state.items[id] = { startedAt, originalHash: old.contentHash, url: old.url, retries: [] };
    writeJson(checkpointPath, state);
    try {
      const page = await fetchWithRetry(get, old.url, { wait, deadline, onRetry: event => {
        state.items[id].retries.push(event); writeJson(checkpointPath, state);
      } });
      const extracted = extractContent(page.html);
      const contentStatus = extracted.content.length >= 120 ? 'ready' : 'insufficient_content';
      // Avoid overwriting a concurrent update even within a local checkout.
      if (readJson(file).contentHash !== old.contentHash) throw new Error('concurrent_raw_change');
      const record = { ...old, ...extracted, contentStatus, contentHash: sha256(extracted.content),
        lastFetchAt: new Date().toISOString(), fetchedUrl: page.finalUrl,
        contentError: contentStatus === 'ready' ? '' : '正文不足 120 字符，禁止仅凭标题宣布分析完成' };
      writeJson(file, record);
      Object.assign(state.items[id], { status: contentStatus, contentHash: record.contentHash, contentLength: record.content.length });
    } catch (error) {
      const reason = error.message || 'fetch_error';
      Object.assign(state.items[id], { status: 'fetch_failed', error: reason, cause: error.cause?.code || '' });
      // Budget exhaustion is resumable and must not starve later IDs on the next run.
      if (reason === 'request_budget_exhausted') { state.items[id].deferred = true; return; }
      if (reason !== 'concurrent_raw_change' && readJson(file).contentHash === old.contentHash) {
        writeJson(file, { ...old, lastFetchAt: new Date().toISOString(),
          contentStatus: old.contentStatus === 'ready' ? 'ready' : 'fetch_failed',
          contentError: reason, contentHash: sha256(old.content || '') });
      }
    } finally {
      if (!state.items[id].deferred) state.items[id].finishedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString(); writeJson(checkpointPath, state);
      completed++; console.log(JSON.stringify({ id, ...state.items[id] }));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, async () => {
    while (targets.length && Date.now() < deadline) {
      const index = targets.findIndex(id => {
        const raw = readJson(path.join(root, `data/raw/${id}.json`), null);
        return !busy.has(raw ? new URL(raw.url).origin : id);
      });
      if (index < 0) return;
      const [id] = targets.splice(index, 1), raw = readJson(path.join(root, `data/raw/${id}.json`), null);
      const origin = raw ? new URL(raw.url).origin : id; busy.add(origin);
      try { await hydrate(id); } finally { busy.delete(origin); }
    }
  }));
  writeJson(checkpointPath, state);
  return { completed, finished: ids.filter(id => state.items[id]?.finishedAt).length, total: ids.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, checkpointPath, count] = process.argv.slice(2);
  if (!manifestPath || !checkpointPath) throw new Error('Usage: node scripts/backfill-targets.mjs manifest.json checkpoint.json [limit]');
  console.log(JSON.stringify(await backfillTargets({ manifest: readJson(manifestPath), checkpointPath,
    limit: Number(count) || 40 })));
}

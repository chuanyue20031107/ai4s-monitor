import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { publish, rawRecords, readJson, writeJson } from './pipeline.mjs';
import { reconcileCommands, validateCommand } from './ai-commands-core.mjs';

export function runWorker(root, { limit = 'existing', instruction = '分析待处理的 AI4S 情报，依据原文给出分类、评分、中文摘要与限制。', query = '', requestId } = {}) {
  if (limit !== 'existing') {
    const command = { schemaVersion: 1, id: requestId || randomUUID(), type: 'analyze',
      limit: limit === 'all' ? 'all' : Number(limit), instruction, query, createdAt: new Date().toISOString() };
    validateCommand(command, `${command.id}.json`);
    const filename = path.join(root, 'data/ai-commands/pending', `${command.id}.json`);
    // Stable workflow run ID makes re-running the same dispatch idempotent.
    if (!fs.existsSync(filename)) writeJson(filename, command);
  }
  publish(root);
  const raws = rawRecords(root);
  const articles = readJson(path.join(root, 'client/public/data/articles.json'), { items: [] }).items;
  const analyses = new Map(articles.filter((a) => a.batchFile).map((a) => {
    const accepted = readJson(path.join(root, a.batchFile)).analyses.find((entry) => entry.articleId === a.id);
    return [a.id, { ...accepted, batchFile: a.batchFile }];
  }));
  const result = reconcileCommands(root, raws, analyses, { admit: true });
  publish(root);
  return { commands: result.results.length, pendingTasks: result.tasks.length,
    rejected: result.results.filter((r) => r.status === 'rejected').length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runWorker(process.cwd(), { limit: process.env.AI_BATCH_SIZE || 'existing',
      instruction: process.env.AI_INSTRUCTION || undefined, query: process.env.AI_QUERY || '',
      requestId: process.env.GITHUB_RUN_ID ? `dispatch-${process.env.GITHUB_RUN_ID}` : undefined });
    console.log(JSON.stringify(result));
    if (result.rejected) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

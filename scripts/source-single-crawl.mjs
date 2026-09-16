import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sourceId = process.env.SOURCE_ID;
if (!sourceId) throw new Error('SOURCE_ID is required');

const health = JSON.parse(fs.readFileSync('data/source-health.json', 'utf8'));
const item = health.items?.find((x) => x.sourceId === sourceId);
if (!item) {
  console.log(`source ${sourceId} not found in health report, run general crawl instead`);
}

// Reuse existing deterministic crawler. The next pipeline run will publish data.
execFileSync('npm', ['run', 'crawl'], { stdio: 'inherit', env: { ...process.env, BATCH_SIZE: '1', SOURCE_ID: sourceId } });

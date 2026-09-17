/** Daily maintenance runner; the six-hour collector cursor/settings are preserved. */
import { randomUUID } from 'node:crypto';
import { collect } from './crawl.mjs';
import { readJson, writeJson } from './pipeline.mjs';
import { maintainSources } from './source-health-diagnose.mjs';
import { executeOperation } from './source-operations-core.mjs';

const mode = process.env.REPAIR_MODE || 'repair';
if (!['diagnose', 'repair'].includes(mode)) throw new Error('Invalid REPAIR_MODE');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--recrawl-saved')) throw new Error('Unknown source-repair option');
const report = args.includes('--recrawl-saved')
  ? readJson('client/public/data/source-diagnostics.json', { checked: 0, repaired: [] })
  : await maintainSources({ repair: mode === 'repair' });
const recrawlDeadline = Date.now() + 25 * 60_000;
if (mode === 'repair' && process.env.RECRAWL_REPAIRED === 'true') {
  // Only newly repaired sources, never all failures. Remaining repairs join the regular rotation.
  const pending = new Set(readJson('client/public/data/sources.json', {items:[]}).items
    .filter(s => s.repairSuggestion === 'recrawl').map(s => s.sourceKey));
  for (const sourceId of report.repaired.filter(id => pending.has(id)).slice(0, 12)) {
    if (Date.now() >= recrawlDeadline) break;
    const run = await executeOperation({ version: 1, requestId: randomUUID(), action: 'crawl', sourceId }, {
      root: process.cwd(), readJson, writeJson,
      collect: options => collect({ ...options, maxDurationMs: Math.max(0, recrawlDeadline - Date.now()) }),
      resolveSeed: source => ({ ...source, id: source.sourceKey, group: source.groupName }),
    });
    console.log(`${sourceId}: ${run.detail}`);
  }
}
console.log(`Diagnosed ${report.checked}; repaired ${report.repaired.length}. See client/public/data/source-diagnostics.json.`);

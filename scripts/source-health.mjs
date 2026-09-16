import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'client/public/data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const sourceId = process.env.SOURCE_ID || '';
const raw = fs.readFileSync(path.join(root, 'client/src/data/ai4s-sources.ts'), 'utf8');
const names = [...raw.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
const items = names.map((name, index) => ({
  id: `source-${index + 1}`,
  name,
  status: sourceId && `source-${index + 1}` !== sourceId ? 'skipped' : 'pending',
  reason: '',
  checkedAt: new Date().toISOString(),
}));

const result = {
  updatedAt: new Date().toISOString(),
  total: items.length,
  items,
};

fs.writeFileSync(path.join(dataDir, 'source-health.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(publicDir, 'source-health.json'), JSON.stringify(result, null, 2));
console.log(`source health prepared: ${items.length}`);

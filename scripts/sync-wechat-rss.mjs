import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
  const headers = parseCsvLine(lines[0]).map((v) => v.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const configPath = process.env.WECHAT_SOURCES_FILE
  ? path.resolve(process.env.WECHAT_SOURCES_FILE)
  : path.join(repoRoot, 'config', 'wechat_sources.csv');
const text = await fs.readFile(configPath, 'utf8');
const rows = parseCsv(text);

const payload = {
  baseUrl: requiredEnv('WERSS_BASE_URL'),
  dryRun: /^(1|true|yes)$/i.test(String(process.env.DRY_RUN ?? 'false')),
  items: rows.map((row) => ({
    sourceKey: row.source_key,
    accountName: row.account_name,
    entityName: row.entity_name,
    groupName: row.group_name,
    priority: row.priority,
    feedId: row.feed_id,
    enabled: /^(1|true|yes)$/i.test(row.enabled),
  })),
};

const endpoint = new URL(
  'api/ai4s/sources/wechat-rss/sync',
  normalizeBaseUrl(requiredEnv('AI4S_BASE_URL')),
);
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`AI4S sync failed (${response.status}): ${body}`);
}

try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body);
}

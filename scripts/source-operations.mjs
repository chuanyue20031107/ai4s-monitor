/** GitHub Issue -> authorized source operation -> versioned receipt. No browser credential. */
import fs from 'node:fs';
import path from 'node:path';
import { collect, parseCsv } from './crawl.mjs';
import { readJson, writeJson, makeFetcher, extractEntries, canonicalUrl } from './pipeline.mjs';
import { canOperate, executeOperation, parseIssue } from './source-operations-core.mjs';

const root = process.cwd();
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository');
const apiRoot = `https://api.github.com/repos/${repository}`;
const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const receiptFile = path.join(root, 'client/public/data/source-commands.json');
const archiveFile = path.join(root, 'data/source-commands.json');
const journal = path.join(process.env.RUNNER_TEMP || root, 'source-operations-journal.json');
const event = readJson(process.env.GITHUB_EVENT_PATH, {});
const PREFIX = '[source-op]';
async function api(route, method = 'GET', body) {
  const response = await fetch(`${apiRoot}${route}`, {
    method, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API HTTP_${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function hasWrite(login) {
  try { return canOperate((await api(`/collaborators/${encodeURIComponent(login)}/permission`)).permission); }
  catch { return false; } // Fail closed; association alone is not an authorization check.
}
function resolveSeed(source) {
  const rows = parseCsv(fs.existsSync('config/wechat_sources.csv') ? fs.readFileSync('config/wechat_sources.csv', 'utf8') : '');
  const row = rows.find(r => r.source_key?.trim() === source.sourceKey);
  const wechat = Boolean(row) || source.type === '微信公众号';
  const base = String(process.env.WERSS_BASE_URL || '').trim();
  const endpoint = wechat && base && row?.feed_id?.trim() ? canonicalUrl(`feed/${encodeURIComponent(row.feed_id.trim())}.xml`, `${base.replace(/\/$/, '')}/`) : '';
  return { ...source, id: source.sourceKey, group: source.groupName, _wechat: wechat, _fetchUrl: endpoint || '' };
}
async function prepare() {
  const actor = event.sender?.login || process.env.GITHUB_ACTOR;
  if (!actor || !await hasWrite(actor)) throw new Error('Only repository writers can operate sources');
  const issues = new Map();
  // Include the triggering issue explicitly; do not depend on search-index freshness.
  if (event.issue?.number) {
    const issue = await api(`/issues/${Number(event.issue.number)}`);
    if (issue.state === 'open') issues.set(issue.number, issue);
  }
  for (let page = 1; page <= 10; page++) {
    const items = await api(`/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
    for (const issue of items) if (!issue.pull_request && issue.title.startsWith(PREFIX)) issues.set(issue.number, issue);
    if (items.length < 100) break;
  }
  let ledger = readJson(archiveFile, readJson(receiptFile, { items: [] }));
  const results = [];
  const sources = () => readJson('client/public/data/sources.json', { items: [] }).items;
  const eligible = [...issues.values()].filter(i => !i.pull_request && i.title.startsWith(PREFIX));
  if (eligible.length > 20) throw new Error('More than 20 open requests; close old requests before retrying');
  for (const issue of eligible.sort((a,b) => a.number - b.number)) {
    if (!await hasWrite(issue.user.login)) { results.push({ issueNumber: issue.number, status: 'rejected', detail: '无仓库写入权限，请求未执行。' }); continue; }
    const previous = ledger.items.find(r => r.issueNumber === issue.number);
    if (previous) { results.push(previous); continue; } // Idempotence across workflow reruns.
    let command;
    try { command = parseIssue(issue.body, sources()); }
    catch { results.push({ issueNumber: issue.number, status: 'rejected', detail: '请求格式、参数或来源编号无效；未执行。' }); continue; }
    if (ledger.items.some(r => r.requestId === command.requestId)) { results.push({ issueNumber: issue.number, status: 'rejected', detail: '请求编号已使用；未重复执行。' }); continue; }
    let record = { ...command, issueNumber: issue.number, issueUrl: issue.html_url, runUrl, startedAt: new Date().toISOString() };
    try {
      const run = await executeOperation(command, { root, readJson, writeJson, collect, makeFetcher, extractEntries, resolveSeed });
      record = { ...record, status: run.failed ? 'partial' : 'success', detail: run.detail, processed: run.processed, failed: run.failed, finishedAt: run.finishedAt };
    } catch {
      record = { ...record, status: 'failed', detail: '操作未完成；请检查来源是否停用、配置是否齐全或查看 Actions 日志，然后发起新请求。', finishedAt: new Date().toISOString() };
    }
    ledger = { items: [record, ...ledger.items], updatedAt: new Date().toISOString() };
    writeJson(archiveFile, ledger);
    writeJson(receiptFile, { ...ledger, items: ledger.items.slice(0, 500) }); results.push(record);
  }
  writeJson(journal, { results });
  console.log(`Processed ${results.length} source requests; results must be committed before success is reported.`);
}
async function report() {
  const saved = process.env.SOURCE_DATA_SAVED === 'true';
  const deployed = process.env.SOURCE_PAGES_DEPLOYED === 'true';
  let results = readJson(journal, { results: [] }).results;
  if (!results.length && event.issue?.number) results = [{ issueNumber: event.issue.number }];
  for (const result of results) {
    let message;
    if (!saved) message = `来源操作未完成持久化或发生并发冲突，不能确认成功。原定时任务未修改。请查看 [Actions 记录](${runUrl})，解决后重新运行本工作流。`;
    else if (result.status === 'rejected') message = `${result.detail}\n\n[Actions 记录](${runUrl})`;
    else message = `${result.detail}\n\n数据已写入仓库。${deployed ? 'Pages 已重新发布。' : 'Pages 未确认发布；监控来源页可读取仓库最新结果。'}\n\n[Actions 记录](${runUrl})`;
    // Receipt archive prevents re-execution after edits, reopening, or workflow reruns.
    await api(`/issues/${result.issueNumber}/comments`, 'POST', { body: message });
    if (saved) await api(`/issues/${result.issueNumber}`, 'PATCH', { state: 'closed', state_reason: result.status === 'success' ? 'completed' : 'not_planned' });
  }
}
if (process.argv[2] === 'report') await report(); else await prepare();

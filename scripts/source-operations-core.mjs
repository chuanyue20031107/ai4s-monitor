/** Explicit, bounded source operations. Dependencies are injected for offline tests. */
import fs from 'node:fs';
import path from 'node:path';

export const ACTIONS = ['health_check', 'crawl', 'crawl_all', 'retry_failed', 'set_enabled'];
export const FAILURE = new Set(['invalid_url', 'robots_blocked', 'timeout', 'network_error', 'parse_failed', 'needs_config', 'failed']);
export function validateCommand(value, sources) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求必须是 JSON 对象');
  if (Object.keys(value).some(k => !['version', 'requestId', 'action', 'sourceId', 'enabled'].includes(k))) throw new Error('请求包含不支持的字段');
  if (value.version !== 1 || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.requestId || '') || !ACTIONS.includes(value.action)) throw new Error('请求版本、编号或操作无效');
  const single = ['crawl', 'set_enabled'].includes(value.action);
  if ((single && !value.sourceId) || (value.sourceId !== undefined && (!/^[\w-]{1,100}$/.test(value.sourceId) || !sources.some(s => s.sourceKey === value.sourceId)))) throw new Error('来源编号不存在');
  if (['crawl_all', 'retry_failed'].includes(value.action) && value.sourceId !== undefined) throw new Error('批量操作不能指定单个来源');
  if (value.action === 'set_enabled' ? typeof value.enabled !== 'boolean' : value.enabled !== undefined) throw new Error('启用状态必须为明确的布尔值，且只用于启停操作');
  return { ...value };
}
export function parseIssue(body, sources) {
  if (typeof body !== 'string' || body.length > 8000) throw new Error('请求正文无效');
  const blocks = [...body.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) throw new Error('请求必须包含且仅包含一个 JSON 代码块');
  return validateCommand(JSON.parse(blocks[0][1]), sources);
}
export const canOperate = permission => ['admin', 'maintain', 'write'].includes(permission);
export function selectTargets(command, sources) {
  const selected = command.sourceId ? sources.filter(s => s.sourceKey === command.sourceId) : sources;
  if (command.action === 'health_check' || command.action === 'set_enabled') return selected;
  const active = selected.filter(s => s.enabled !== false && s.crawlStrategy !== 'disabled');
  if (command.action === 'crawl' && !active.length) throw new Error('该来源已停用，请先启用');
  return command.action === 'retry_failed' ? active.filter(s => FAILURE.has(s.crawlStatus)) : active;
}
export function diagnose(error) {
  const message = String(error?.message || '');
  if (message === 'needs_config') return ['needs_config', '缺少可抓取地址；公众号需在私密配置中填写 WeRSS 地址与 feed_id。'];
  if (message === 'robots_blocked') return ['robots_blocked', '站点 robots.txt 禁止访问；请使用获授权的 RSS/API，不绕过限制。'];
  if (/invalid|private_address/.test(message)) return ['invalid_url', '地址无效或指向非公网地址；请检查已登记的公开链接。'];
  if (error?.name === 'TimeoutError' || /timeout/i.test(message)) return ['timeout', '连接超时；可稍后重试或检查来源可用性。'];
  if (/unsupported_content|parse_failed/.test(message)) return ['parse_failed', '返回内容无法解析；请核对订阅格式或采集入口。'];
  if (/HTTP_(401|403|429)/.test(message)) return ['network_error', `${message.match(/HTTP_\d+/)[0]}：认证、访问限制或限流；请使用授权入口或稍后重试。`];
  if (message === 'request_budget_exhausted') return ['network_error', '达到本次安全请求上限；请单独重试剩余来源。'];
  return ['network_error', '网络或站点响应异常；请核对入口并稍后重试。'];
}
export function healthSummary(sources, run) {
  const counts = new Map();
  for (const s of sources) if (FAILURE.has(s.crawlStatus)) counts.set(s.crawlStatus, (counts.get(s.crawlStatus) || 0) + 1);
  return { stats: { runId: run.id, status: run.status, running: false, total: sources.length,
    ok: sources.filter(s => s.crawlStatus === 'ok').length, noContent: sources.filter(s => s.crawlStatus === 'no_content').length,
    failed: [...counts.values()].reduce((a,b) => a+b, 0), failureByType: [...counts].map(([type,count]) => ({type,count})), lastCheckAt: run.finishedAt } };
}
/** Preserve exact scheduled cursor/settings bytes and the complete source list, even on error. */
export async function executeOperation(command, { root, readJson, writeJson, collect, makeFetcher, extractEntries, resolveSeed }) {
  const pub = name => path.join(root, 'client/public/data', `${name}.json`);
  const original = readJson(pub('sources'), { items: [] });
  command = validateCommand(command, original.items);
  const targets = selectTargets(command, original.items);
  const startedAt = new Date().toISOString();
  let run = { id: `source-command:${command.requestId}`, taskType: '手动来源操作', status: 'success', processed: 0, succeeded: 0, failed: 0, inserted: 0, enriched: 0, startedAt, finishedAt: null, detail: '', failureReason: '' };
  const changed = new Map();
  if (command.action === 'set_enabled') {
    changed.set(targets[0].sourceKey, { ...targets[0], enabled: command.enabled });
    run.processed = 1; run.succeeded = 1;
    run.detail = `已${command.enabled ? '启用' : '停用'}来源 ${targets[0].name}；定时任务按原计划读取此状态。`;
  } else if (command.action === 'health_check') {
    run.taskType = '来源健康检查';
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (next < targets.length) {
        const source = targets[next++], s = { ...source, lastCheckAt: new Date().toISOString() };
        try {
          const seed = resolveSeed(s), url = seed._wechat ? seed._fetchUrl : seed.feedUrl || seed.website || seed.github;
          if (!url) throw new Error('needs_config');
          // Separate, bounded budget per source; still uses the existing robots/DNS/redirect checks.
          const page = await makeFetcher({ timeoutSeconds: 15, maxRequests: 12 })(url);
          const count = extractEntries(page.html, page.finalUrl).length;
          s.crawlStatus = count ? 'ok' : 'no_content'; s.lastError = '';
          s.lastDiagnostic = count ? `检查可解析 ${count} 条候选；本次未抓取正文、未进行 AI 分析。` : '入口可访问但未发现可解析条目；可能需要 RSS/专用解析器，不代表网站没有更新。';
          run.succeeded++;
        } catch (error) { const [status, advice] = diagnose(error); s.crawlStatus = status; s.lastError = status; s.lastDiagnostic = advice; run.failed++; }
        changed.set(s.sourceKey, s); run.processed++;
      }
    }));
    run.detail = `检查 ${run.processed} 个来源：成功 ${run.succeeded}，失败 ${run.failed}；未抓取正文。`;
  } else if (targets.length) {
    // collect() is reused, not modified. It normally rotates sources and rewrites the source view.
    const protectedFiles = ['meta', 'settings', 'health'].map(name => [pub(name), fs.existsSync(pub(name)) ? fs.readFileSync(pub(name)) : null]);
    const originalRuns = readJson(pub('runs'), { items: [] });
    try {
      for (let start = 0; start < targets.length; start += 12) {
        const batch = targets.slice(start, start + 12).map(resolveSeed);
        const result = await collect({ root, seeds: batch, batchSize: batch.length, maxPerSource: 3 });
        for (const s of readJson(pub('sources'), { items: [] }).items) if (batch.some(b => b.id === s.sourceKey)) changed.set(s.sourceKey, s);
        for (const key of ['processed', 'succeeded', 'failed', 'inserted', 'enriched']) run[key] += result[key] || 0;
      }
    } finally {
      for (const [file, bytes] of protectedFiles) { if (bytes === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, bytes); }
      writeJson(pub('sources'), { ...original, items: original.items.map(s => changed.get(s.sourceKey) || s), updatedAt: new Date().toISOString() });
      writeJson(pub('runs'), originalRuns);
    }
    run.taskType = command.action === 'crawl' ? '单来源手动抓取' : command.action === 'retry_failed' ? '失败来源重试' : '手动全量抓取';
    run.detail = `抓取 ${run.processed} 个来源：成功 ${run.succeeded}，失败 ${run.failed}；新增 ${run.inserted}，补正文 ${run.enriched}；未进行 AI 分析。`;
  } else run.detail = '没有符合条件的已启用来源，本次未发出网络请求。';
  run.finishedAt = new Date().toISOString(); run.status = run.failed ? 'failed' : 'success';
  run.failureReason = run.failed ? '部分来源失败；成功结果保留，可在来源详情查看诊断后重试。' : '';
  const merged = original.items.map(s => changed.get(s.sourceKey) || s);
  writeJson(pub('sources'), { ...original, items: merged, updatedAt: run.finishedAt });
  if (command.action !== 'set_enabled') writeJson(pub('health'), healthSummary(merged, run));
  const history = readJson(pub('runs'), { items: [] });
  writeJson(pub('runs'), { items: [run, ...history.items.filter(r => r.id !== run.id)].slice(0, 300), updatedAt: run.finishedAt });
  return run;
}

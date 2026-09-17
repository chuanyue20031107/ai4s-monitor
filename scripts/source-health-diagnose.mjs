/** Public-source diagnostics. No article collection, AI analysis or private WeRSS URLs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, lookupPublic, makeFetcher, readJson, robotsAllowed, writeJson } from './pipeline.mjs';
import { feedKind, feedLinks, sourceEntries, sourceEntry } from './source-content.mjs';

export const DIAGNOSE_STATUSES = new Set(['network_error', 'timeout', 'failed']);
export function failureType(error) {
  const message = String(error?.message || ''), code = error?.cause?.code || error?.code || '';
  if (error?.cloudflare || message === 'cloudflare_challenge') return 'cloudflare_blocked';
  if (message === 'robots_blocked') return 'robots_blocked';
  if (/private|invalid/.test(message)) return 'invalid_url';
  if (/CERT|TLS|SSL/.test(code)) return 'https_error';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns_error';
  if (error?.name === 'TimeoutError' || /timeout/i.test(message) || /TIMEOUT|ETIMEDOUT/.test(code)) return 'timeout';
  if (/HTTP_\d+/.test(message)) return `http_${message.match(/HTTP_(\d+)/)[1]}`;
  if (/unsupported_content|parse_failed/.test(message)) return 'parse_failed';
  return 'network_error';
}
export function repairDefaults(source) {
  return { failureType: '', repairSuggestion: '', autoRepairAvailable: false, ...source };
}
const canRepair = (source, kind, url) => Boolean(kind && url && source.enabled !== false && source.crawlStrategy !== 'disabled'
  && !(source.crawlStrategy === kind && source.discoveredFeedUrl === url));
function candidates(entry, html, robots) {
  const url = new URL(entry), base = `${url.origin}/`;
  const paths = url.pathname.split('/').filter(Boolean);
  // Probe scoped feed endpoints first, then common public endpoints. Never guess alternate hosts.
  const scoped = [];
  for (let length = paths.length; length >= 1 && scoped.length < 4; length--) scoped.push(`/${paths.slice(0, length).join('/')}/feed/`);
  return {
    rss: [...new Set([...feedLinks(html, entry), ...scoped.map(p => canonicalUrl(p, base)),
      ...['/feed/', '/rss.xml', '/feed.xml', '/atom.xml', '/blog/rss.xml', '/news/rss.xml'].map(p => canonicalUrl(p, base))])].filter(Boolean).slice(0, 12),
    sitemap: [...new Set(['/sitemap.xml', '/sitemap_index.xml'].map(p => canonicalUrl(p, base))
      .concat([...robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map(m => canonicalUrl(m[1], base)), canonicalUrl('/sitemap-index.xml', base)))].filter(Boolean).slice(0, 5),
  };
}
export async function diagnoseSource(source, { makeClient = makeFetcher, resolveDns = lookupPublic, clock = () => new Date().toISOString() } = {}) {
  const entryUrl = sourceEntry(source);
  const result = { sourceKey: source.sourceKey, name: source.name, oldStatus: source.crawlStatus,
    entryUrl: '', checkedAt: clock(), diagnosis: '', failureType: '', suggestion: 'manual_config',
    autoRepairAvailable: false, rss: null, sitemap: null, repairStatus: 'not_applied',
    checks: { dns: 'not_checked', https: 'not_checked', robots: 'not_checked', httpStatus: null, robotsHttpStatus: null, rss: 'not_checked', sitemap: 'not_checked' } };
  // A private WeRSS runtime address must never appear in the public diagnostic artifact.
  if (source._wechat || source.type === '微信公众号') return { ...result, diagnosis: 'needs_config', failureType: 'needs_config' };
  const url = canonicalUrl(entryUrl);
  if (!url) return { ...result, diagnosis: 'invalid_url', failureType: 'invalid_url' };
  result.entryUrl = url;
  try { await resolveDns(new URL(url).hostname.replace(/[\[\]]/g, '')); result.checks.dns = 'ok'; }
  catch (error) {
    result.checks.dns = failureType(error) === 'invalid_url' ? 'blocked' : 'failed';
    return { ...result, diagnosis: failureType(error), failureType: failureType(error), suggestion: 'check_dns' };
  }
  const get = makeClient({ timeoutSeconds: 8, maxRequests: 28 });
  let robots = '', page = null, primaryError = null;
  try {
    const robotPage = await get.robots(url);
    robots = robotPage.html; result.checks.robotsHttpStatus = robotPage.status;
    result.checks.robots = robotsAllowed(robots, url) ? 'allowed' : 'blocked';
    if (robotPage.finalUrl.startsWith('https:')) result.checks.https = 'ok';
  } catch (error) {
    result.checks.robots = 'unavailable'; result.checks.robotsHttpStatus = error.httpStatus || null;
    result.checks.https = error.httpsReached ? 'ok' : new URL(url).protocol === 'https:' ? 'failed' : 'not_checked';
    return { ...result, diagnosis: failureType(error), failureType: failureType(error), suggestion: 'check_robots' };
  }
  try {
    page = await get(url); result.checks.httpStatus = page.status;
    if (page.finalUrl.startsWith('https:')) result.checks.https = 'ok';
  } catch (error) { primaryError = error; result.checks.httpStatus = error.httpStatus || null; }
  // HTTP-only entries get an explicit HTTPS probe; failure does not silently rewrite their URL.
  if (new URL(url).protocol === 'http:' && result.checks.https !== 'ok') {
    try { await get(url.replace(/^http:/, 'https:')); result.checks.https = 'ok'; }
    catch (error) { result.checks.https = error.httpsReached ? 'ok' : 'failed'; }
  }
  const discovered = candidates(page?.finalUrl || url, page?.html || '', robots);
  const probe = async (kind, urls) => {
    let uncertain = false, empty = false;
    for (const candidate of urls) {
      try {
        const found = page?.finalUrl === candidate ? page : await get(candidate);
        if (feedKind(found.html) !== kind) continue;
        const count = (await sourceEntries(found, get)).length;
        if (!count) { empty = true; continue; }
        result[`${kind}Candidates`] = count;
        result[kind] = found.finalUrl; result.checks[kind] = 'available'; return;
      } catch (error) {
        if (!/^HTTP_(404|410)$|^robots_blocked$/.test(error.message)) uncertain = true;
        if (error.message === 'request_budget_exhausted') break;
      }
    }
    result.checks[kind] = uncertain ? 'inconclusive' : empty ? 'empty' : 'not_found';
  };
  const directKind = page && feedKind(page.html);
  if (directKind) discovered[directKind].unshift(page.finalUrl);
  await probe('rss', discovered.rss);
  await probe('sitemap', discovered.sitemap);
  result.failureType = primaryError ? failureType(primaryError) : 'no_public_entry';
  const kind = result.rss ? 'rss' : result.sitemap ? 'sitemap' : '';
  result.diagnosis = kind ? `${kind}_available` : primaryError ? result.failureType
    : result.checks.rss === 'inconclusive' || result.checks.sitemap === 'inconclusive' ? 'discovery_inconclusive' : 'no_public_entry';
  if (kind) {
    result.suggestion = `switch_to_${kind}`;
    result.autoRepairAvailable = canRepair(source, kind, result[kind]);
    if (!result.autoRepairAvailable) result.suggestion = source.enabled === false || source.crawlStrategy === 'disabled' ? 'enable_manually' : 'retry_current_entry';
    if (!primaryError) result.failureType = '';
  }
  return result;
}

export async function maintainSources({ root = process.cwd(), diagnose = true, repair = false, sourceId, dependencies = {} } = {}) {
  const file = name => path.join(root, 'client/public/data', `${name}.json`);
  const snapshot = readJson(file('sources'), { items: [] });
  const items = snapshot.items.map(repairDefaults);
  const previous = readJson(file('source-diagnostics'), { items: [] });
  const diagnostics = new Map(previous.items.map(d => [d.sourceKey, d]));
  const targets = items.filter(s => DIAGNOSE_STATUSES.has(s.crawlStatus) && (!sourceId || s.sourceKey === sourceId));
  let cursor = 0;
  if (diagnose) await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
    while (cursor < targets.length) {
      const source = targets[cursor++];
      const diagnosis = await diagnoseSource(source, dependencies);
      diagnostics.set(source.sourceKey, diagnosis);
      Object.assign(source, { failureType: diagnosis.failureType, repairSuggestion: diagnosis.suggestion,
        autoRepairAvailable: diagnosis.autoRepairAvailable, lastCheckAt: diagnosis.checkedAt,
        lastDiagnostic: `诊断：${diagnosis.diagnosis}；建议：${diagnosis.suggestion}；尚未重新抓取正文。` });
      console.log(`${source.sourceKey}: ${diagnosis.diagnosis} (${diagnosis.suggestion})`);
    }
  }));
  const repaired = [];
  if (repair) for (const source of targets) {
    const record = diagnostics.get(source.sourceKey);
    if (!record?.autoRepairAvailable || record.entryUrl !== canonicalUrl(sourceEntry(source))) continue;
    const age = Date.now() - Date.parse(record.checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > 86400000) { source.autoRepairAvailable = false; source.repairSuggestion = 'diagnose_again'; continue; }
    const kind = record.rss ? 'rss' : record.sitemap ? 'sitemap' : '', url = record[kind];
    if (!canRepair(source, kind, url)) continue;
    try {
      // Revalidate saved findings before changing strategy. DNS/robots/redirect checks still apply.
      const get = (dependencies.makeClient || makeFetcher)({ timeoutSeconds: 8, maxRequests: 10 });
      const page = await get(url);
      if (feedKind(page.html) !== kind || !(await sourceEntries(page, get)).length) throw new Error('parse_failed');
      source.crawlStrategy = kind; source.discoveredFeedUrl = page.finalUrl;
      source.autoRepairAvailable = false; source.repairSuggestion = 'recrawl';
      source.lastDiagnostic = `已切换到验证通过的 ${kind === 'rss' ? 'RSS / Atom' : 'Sitemap'}，等待重新抓取；原失败状态保留到抓取成功。`;
      record.repairStatus = 'applied'; record.repairedAt = new Date().toISOString(); record.autoRepairAvailable = false;
      repaired.push(source.sourceKey);
    } catch (error) {
      source.autoRepairAvailable = false; source.repairSuggestion = 'diagnose_again';
      record.repairStatus = 'validation_failed'; record.repairError = failureType(error); record.autoRepairAvailable = false;
    }
  }
  const updatedAt = new Date().toISOString();
  writeJson(file('sources'), { ...snapshot, items, updatedAt });
  const report = { version: 1, updatedAt, checked: diagnose ? targets.length : 0, repaired, items: [...diagnostics.values()] };
  writeJson(file('source-diagnostics'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => !['--repair', '--saved'].includes(a))) throw new Error('Usage: node scripts/source-health-diagnose.mjs [--repair] [--saved]');
    const result = await maintainSources({ repair: args.includes('--repair'), diagnose: !args.includes('--saved') });
    console.log(JSON.stringify({ checked: result.checked, repaired: result.repaired }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

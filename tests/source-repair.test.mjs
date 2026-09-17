import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnoseSource, maintainSources } from '../scripts/source-health-diagnose.mjs';
import { fetchWithRetry } from '../scripts/source-retry.mjs';
import { feedKind, sourceEntries, sourceEntry } from '../scripts/source-content.mjs';
import { makeFetcher, readJson, writeJson, robotsAllowed } from '../scripts/pipeline.mjs';
import { collect } from '../scripts/crawl.mjs';
import { executeOperation, validateCommand } from '../scripts/source-operations-core.mjs';

const source = { id: 'lab', sourceKey: 'lab', name: 'Lab', website: 'https://example.org/research/', crawlStatus: 'network_error', crawlStrategy: 'auto', enabled: true };
const content = 'Published scientific evidence and experimental measurements from a protein design study. '.repeat(5);
const feed = `<rss><channel><item><title>Protein design research results</title><link>https://example.org/news/protein</link><description>${content}</description></item></channel></rss>`;
const sitemap = '<urlset><url><loc>/news/protein</loc><lastmod>2026-01-01</lastmod></url></urlset>';
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pub = n => path.join(root, 'client/public/data', `${n}.json`);
  writeJson(pub('sources'), { items: [source] });
  return { root, pub };
};
function dependencies(pages = {}, robots = '', error = null) {
  const requests = [];
  const makeClient = () => {
    const get = async url => {
      requests.push(url);
      if (!robotsAllowed(robots, url)) throw new Error('robots_blocked');
      if (!(url in pages)) throw error || Object.assign(new Error('HTTP_404'), { httpStatus: 404 });
      return { html: pages[url], finalUrl: url, status: 200 };
    };
    get.robots = async url => ({ html: robots, finalUrl: `${new URL(url).origin}/robots.txt`, status: 200 });
    return get;
  };
  return { makeClient, resolveDns: async () => [{ address: '93.184.216.34' }], requests };
}
test('diagnostics identify real RSS and sitemap, prefer RSS, retain the original HTTP failure', async () => {
  const d = await diagnoseSource(source, dependencies({ 'https://example.org/feed/': feed, 'https://example.org/sitemap.xml': sitemap }));
  assert.equal(d.diagnosis, 'rss_available'); assert.equal(d.suggestion, 'switch_to_rss');
  assert.equal(d.failureType, 'http_404'); assert.equal(d.checks.httpStatus, 404);
  assert.equal(d.checks.dns, 'ok'); assert.equal(d.checks.https, 'ok'); assert.equal(d.checks.robots, 'allowed');
  assert.equal(d.autoRepairAvailable, true); assert.equal(d.sitemap, 'https://example.org/sitemap.xml');
});
test('HTML soft 404s and Cloudflare pages are not feeds, even with embedded RSS examples', async () => {
  assert.equal(feedKind('<html><body><rss><item>example</item></rss></body></html>'), '');
  const d = await diagnoseSource(source, dependencies({ 'https://example.org/feed/': '<html>Not found</html>' }, '', Object.assign(new Error('HTTP_403'), { httpStatus: 403, cloudflare: true })));
  assert.equal(d.diagnosis, 'cloudflare_blocked'); assert.equal(d.autoRepairAvailable, false);
});
test('robots blocks forbidden endpoints but permits an explicitly allowed public RSS', async () => {
  const deps = dependencies({ 'https://example.org/feed/': feed }, 'User-agent: *\nDisallow: /\nAllow: /feed/');
  const d = await diagnoseSource(source, deps);
  assert.equal(d.failureType, 'robots_blocked'); assert.equal(d.checks.robots, 'blocked'); assert.equal(d.rss, 'https://example.org/feed/');
  const blocked = await diagnoseSource(source, dependencies({ 'https://example.org/feed/': feed }, 'User-agent: *\nDisallow: /'));
  assert.equal(blocked.autoRepairAvailable, false);
});
test('DNS failure stops further requests, WeRSS/private/token URLs never leak', async () => {
  const deps = dependencies(); deps.resolveDns = async () => { throw Object.assign(new Error('no host'), { code: 'ENOTFOUND' }); };
  const d = await diagnoseSource(source, deps);
  assert.equal(d.diagnosis, 'dns_error'); assert.equal(deps.requests.length, 0);
  for (const s of [{...source,website:'http://127.0.0.1/'}, {...source,website:'https://example.org/?token=SECRET'}, {...source,type:'微信公众号',_fetchUrl:'https://secret.example/feed/PRIVATE'}]) {
    const value = await diagnoseSource(s, dependencies());
    assert.equal(value.entryUrl, ''); assert.equal(value.autoRepairAvailable, false);
    assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE|secret.example/);
  }
});
test('feed discovery follows HTML declarations and robots sitemap URLs', async () => {
  const d = await diagnoseSource(source, dependencies({
    [source.website]: '<html><link href="/custom/updates.xml" type="application/atom+xml" rel="alternate"></html>',
    'https://example.org/custom/updates.xml': '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Protein design research results</title><link href="https://example.org/news/protein"/></entry></feed>',
    'https://example.org/maps/news.xml': sitemap,
  }, 'Sitemap: https://example.org/maps/news.xml'));
  assert.equal(d.rss, 'https://example.org/custom/updates.xml'); assert.equal(d.sitemap, 'https://example.org/maps/news.xml');
});
test('empty feeds and irrelevant sitemaps do not qualify for automatic repair', async () => {
  const d = await diagnoseSource(source, dependencies({
    'https://example.org/feed/': '<rss><channel><title>Comments feed</title></channel></rss>',
    'https://example.org/sitemap.xml': '<urlset><url><loc>/about</loc></url></urlset>',
  }));
  assert.equal(d.autoRepairAvailable, false); assert.equal(d.checks.rss, 'empty'); assert.equal(d.checks.sitemap, 'empty');
  const fallback = await diagnoseSource(source, dependencies({'https://example.org/feed/':'<rss><channel/></rss>','https://example.org/sitemap.xml':sitemap}));
  assert.equal(fallback.diagnosis,'sitemap_available'); assert.equal(fallback.sitemapCandidates,1);
});
test('repair filters failure statuses, preserves state, revalidates and never enables disabled sources', async t => {
  const {root,pub} = fixture(t);
  writeJson(pub('sources'), {items:[source,{...source,sourceKey:'healthy',crawlStatus:'ok'},{...source,sourceKey:'disabled',enabled:false},{...source,sourceKey:'empty',crawlStatus:'no_content'}]});
  const preserved = ['meta','settings','articles','digest'].map(n => {writeJson(pub(n),{marker:n,cursor:77}); return [pub(n),fs.readFileSync(pub(n))];});
  const deps = dependencies({'https://example.org/feed/':feed});
  const first = await maintainSources({root,dependencies:deps});
  assert.equal(first.checked,2); assert.equal(readJson(pub('sources')).items[0].crawlStrategy,'auto');
  const repaired = await maintainSources({root,diagnose:false,repair:true,dependencies:deps});
  assert.deepEqual(repaired.repaired,['lab']);
  const sources = readJson(pub('sources')).items;
  assert.equal(sources[0].crawlStrategy,'rss'); assert.equal(sources[0].crawlStatus,'network_error');
  assert.equal(sourceEntry(sources[0]),'https://example.org/feed/'); assert.equal(sources[0].autoRepairAvailable,false);
  assert.equal(sources[2].enabled,false); assert.equal(sources[2].crawlStrategy,'auto');
  for (const [file,bytes] of preserved) assert.deepEqual(fs.readFileSync(file),bytes);
});
test('stale, changed and no-longer-valid findings cannot silently change a strategy', async t => {
  const {root,pub} = fixture(t), deps = dependencies({'https://example.org/feed/':feed});
  await maintainSources({root,dependencies:deps});
  const report=readJson(pub('source-diagnostics')); report.items[0].checkedAt='2020-01-01T00:00:00Z'; writeJson(pub('source-diagnostics'),report);
  assert.equal((await maintainSources({root,diagnose:false,repair:true,dependencies:deps})).repaired.length,0);
  await maintainSources({root,dependencies:deps});
  const changed=readJson(pub('sources')); changed.items[0].website='https://changed.example/'; writeJson(pub('sources'),changed);
  assert.equal((await maintainSources({root,diagnose:false,repair:true,dependencies:deps})).repaired.length,0);
  writeJson(pub('sources'),{items:[source]}); await maintainSources({root,dependencies:deps});
  const invalid = await maintainSources({root,diagnose:false,repair:true,dependencies:dependencies()});
  assert.equal(invalid.repaired.length,0); assert.equal(invalid.items[0].repairStatus,'validation_failed');
  assert.equal(readJson(pub('sources')).items[0].crawlStrategy,'auto');
});
test('sitemap repair works without RSS and the collector fetches real titles/bodies', async t => {
  const {root,pub}=fixture(t), deps=dependencies({'https://example.org/sitemap.xml':sitemap,'https://example.org/news/protein':`<html><title>Real protein research title</title><article>${content}</article></html>`});
  const report=await maintainSources({root,repair:true,dependencies:deps});
  assert.deepEqual(report.repaired,['lab']); assert.equal(readJson(pub('sources')).items[0].crawlStrategy,'sitemap');
  await collect({root,seeds:[source],fetchPage:deps.makeClient()});
  const articles=readJson(pub('articles')).items;
  assert.equal(articles[0].title,'Real protein research title'); assert.equal(articles[0].analysisStatus,'pending');
  assert.equal(articles[0].publishedAt,null); assert.equal(readJson(pub('sources')).items[0].failureType,'');
});
test('sitemap index handles relative locs, deduplicates and stops at the traversal budget', async () => {
  const html='<sitemapindex>'+Array.from({length:10},(_,i)=>`<sitemap><loc>/map${i}.xml</loc></sitemap>`).join('')+'</sitemapindex>';
  let calls=0;
  const entries=await sourceEntries({html,finalUrl:'https://example.org/sitemap.xml'},async url=>{calls++;return {html:sitemap,finalUrl:url};});
  assert.equal(calls,3); assert.equal(entries.length,1); assert.equal(entries[0].url,'https://example.org/news/protein');
});
test('network and timeout retries wait exactly 30 seconds then 2 minutes and stop after three attempts', async () => {
  const delays=[];let calls=0;
  await assert.rejects(fetchWithRetry(async()=>{calls++;throw new TypeError('fetch failed');},'https://example.org',{wait:async n=>delays.push(n)}));
  assert.equal(calls,3); assert.deepEqual(delays,[30000,120000]);
  calls=0; delays.length=0;
  const page=await fetchWithRetry(async()=>{if(++calls===1) throw Object.assign(new Error('timeout'),{name:'TimeoutError'});return 'ok';},'https://example.org',{wait:async n=>delays.push(n)});
  assert.equal(page,'ok'); assert.deepEqual(delays,[30000]);
});
test('HTTP, robots, certificate and configuration failures never retry', async () => {
  for(const error of [new Error('HTTP_403'),new Error('HTTP_429'),new Error('HTTP_500'),new Error('robots_blocked'),new Error('needs_config'),Object.assign(new Error('TLS'),{code:'CERT_HAS_EXPIRED'})]) {
    let calls=0;
    await assert.rejects(fetchWithRetry(async()=>{calls++;throw error;},'https://example.org',{wait:()=>assert.fail('must not wait')}));
    assert.equal(calls,1);
  }
});
test('retry runtime budget leaves time to persist before the unchanged scheduled job timeout', async () => {
  let calls=0;
  await assert.rejects(fetchWithRetry(async()=>{calls++;throw new TypeError('fetch failed');},'https://example.org',{deadline:Date.now()+1000,wait:()=>assert.fail('budget exceeded')}),/request_budget_exhausted/);
  assert.equal(calls,1);
});
test('failed DNS and robots promises are evicted so retry sends new requests', async () => {
  let dns=0,robots=0;
  const get=makeFetcher({lookupHost:async()=>{if(++dns===1)throw Object.assign(new Error('DNS'),{code:'EAI_AGAIN'});return [{address:'93.184.216.34'}];},fetchImpl:async url=>{
    if(url.endsWith('/robots.txt')&&++robots===1)throw new TypeError('fetch failed');
    return new Response(url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':feed,{headers:{'content-type':'text/xml'}});
  }});
  const result=await fetchWithRetry(get,'https://example.org/feed/',{wait:async()=>{}});
  assert.equal(result.html,feed);assert.equal(dns,2);assert.equal(robots,2);
});
test('new UI commands are validated and actually execute maintenance without collecting bodies', async t => {
  const {root,pub}=fixture(t), command={version:1,requestId:'test-request-repair',action:'diagnose_failed'};
  assert.throws(()=>validateCommand({...command,sourceId:'lab'},[source]));
  const run=await executeOperation(command,{root,readJson,writeJson,collect:()=>assert.fail('no crawl'),maintain:options=>maintainSources({...options,dependencies:dependencies({'https://example.org/feed/':feed})})});
  assert.equal(run.processed,1);assert.equal(readJson(pub('sources')).items[0].autoRepairAvailable,true);
});

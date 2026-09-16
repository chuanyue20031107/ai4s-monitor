import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCommand, parseIssue, canOperate, selectTargets, diagnose, executeOperation } from '../scripts/source-operations-core.mjs';
const sources = [
  { id:'a', sourceKey:'a', name:'Alpha', enabled:true, crawlStrategy:'auto', crawlStatus:'network_error', website:'https://example.org', lastCrawlAt:'2026-01-01T00:00:00Z' },
  { id:'b', sourceKey:'b', name:'Beta', enabled:true, crawlStrategy:'auto', crawlStatus:'no_content', website:'https://example.org' },
  { id:'c', sourceKey:'c', name:'Gamma', enabled:false, crawlStrategy:'auto', crawlStatus:'timeout', website:'https://example.org' },
];
const cmd = (action, extra = {}) => ({ version:1, requestId:'test-request-1234', action, ...extra });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-ops-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const pub = n => path.join(root, 'client/public/data', `${n}.json`);
  const writeJson = (file,v) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,JSON.stringify(v)); };
  const readJson = (file,fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
  writeJson(pub('sources'), {items:structuredClone(sources)});
  writeJson(pub('runs'), {items:[{id:'old-run'}]});
  writeJson(pub('meta'), {cursor:77}); writeJson(pub('settings'), {settings:{dailyCrawlEnabled:true}});
  return {root,pub,readJson,writeJson,resolveSeed:s=>({...s,id:s.sourceKey})};
}
test('strict commands and explicit enable/disable', () => {
  assert.equal(validateCommand(cmd('set_enabled',{sourceId:'a',enabled:false}),sources).enabled,false);
  for (const value of [cmd('shell'),cmd('crawl',{sourceId:'../secret'}),cmd('crawl',{sourceId:'missing'}),cmd('set_enabled',{sourceId:'a'}),cmd('crawl_all',{url:'https://evil.example'}),cmd('crawl_all',{sourceId:'a'}),cmd('health_check',{enabled:true})]) assert.throws(()=>validateCommand(value,sources));
});
test('only writer permissions; association is not enough', () => {
  for (const p of ['read','triage',undefined,'OWNER']) assert.equal(canOperate(p),false);
  for (const p of ['write','maintain','admin']) assert.equal(canOperate(p),true);
});
test('one JSON block, no shell payload', () => {
  assert.equal(parseIssue('```json\n'+JSON.stringify(cmd('crawl',{sourceId:'a'}))+'\n```',sources).sourceId,'a');
  assert.throws(()=>parseIssue('```json\n{}\n```\n```json\n{}\n```',sources));
  assert.throws(()=>parseIssue('node -e process.exit()',sources));
});
test('retry only failed enabled sources, never no-content or disabled', () => {
  assert.deepEqual(selectTargets(cmd('retry_failed'),sources).map(s=>s.sourceKey),['a']);
  assert.throws(()=>selectTargets(cmd('crawl',{sourceId:'c'}),sources));
});
test('diagnostics redact URLs and credentials', () => {
  assert.equal(diagnose(new Error('robots_blocked'))[0],'robots_blocked');
  assert.equal(diagnose(new Error('private_address_blocked'))[0],'invalid_url');
  assert.ok(!diagnose(new Error('https://secret.example?token=VERYSECRET'))[1].includes('VERYSECRET'));
});
test('single crawl preserves full inventory, disabled states, scheduled cursor/settings', async t => {
  const f=fixture(t), meta=fs.readFileSync(f.pub('meta')), settings=fs.readFileSync(f.pub('settings'));
  const collect=async ({seeds,batchSize}) => {
    assert.deepEqual(seeds.map(s=>s.id),['a']); assert.equal(batchSize,1);
    f.writeJson(f.pub('sources'),{items:[{...seeds[0],crawlStatus:'ok'}]});
    f.writeJson(f.pub('meta'),{cursor:0}); f.writeJson(f.pub('settings'),{changed:true});
    return {processed:1,succeeded:1,failed:0,inserted:2};
  };
  const run=await executeOperation(cmd('crawl',{sourceId:'a'}),{...f,collect});
  const after=f.readJson(f.pub('sources')).items;
  assert.equal(after.length,3); assert.deepEqual(after[1],sources[1]); assert.equal(after[2].enabled,false);
  assert.deepEqual(fs.readFileSync(f.pub('meta')),meta); assert.deepEqual(fs.readFileSync(f.pub('settings')),settings);
  assert.equal(run.inserted,2); assert.match(run.detail,/未进行 AI 分析/);
});
test('failed collector still restores protected scheduled files and sources', async t => {
  const f=fixture(t); const before=fs.readFileSync(f.pub('meta'));
  await assert.rejects(executeOperation(cmd('crawl',{sourceId:'a'}),{...f,collect:async()=>{f.writeJson(f.pub('meta'),{cursor:0}); f.writeJson(f.pub('sources'),{items:[]}); throw new Error('test failure');}}));
  assert.deepEqual(fs.readFileSync(f.pub('meta')),before); assert.deepEqual(f.readJson(f.pub('sources')).items,sources);
});
test('health check does not collect or change last crawl date; reports robots failure', async t => {
  const f=fixture(t); let fetched=0;
  const run=await executeOperation(cmd('health_check',{sourceId:'a'}),{...f,makeFetcher:()=>async()=>{fetched++;throw new Error('robots_blocked');},extractEntries:()=>[],collect:()=>{throw new Error('must not collect');}});
  const after=f.readJson(f.pub('sources')).items;
  assert.equal(fetched,1); assert.equal(after[0].lastCrawlAt,sources[0].lastCrawlAt); assert.equal(after[0].crawlStatus,'robots_blocked'); assert.equal(run.failed,1);
});
test('set enabled is idempotent and does not send network requests', async t => {
  const f=fixture(t);
  for(let i=0;i<2;i++) await executeOperation(cmd('set_enabled',{sourceId:'a',enabled:false}),f);
  assert.equal(f.readJson(f.pub('sources')).items[0].enabled,false);
  assert.equal(f.readJson(f.pub('runs')).items.filter(r=>r.id==='source-command:test-request-1234').length,1);
});
test('real collector integration: manual crawl deduplicates and keeps analyses pending', {skip: !fs.existsSync(new URL('../scripts/crawl.mjs', import.meta.url))}, async t => {
  const {collect: realCollect} = await import('../scripts/crawl.mjs');
  const f = fixture(t), beforeMeta = fs.readFileSync(f.pub('meta'));
  const feed = `<rss><channel><item><title>A detailed scientific materials research finding</title><link>https://example.org/news/research-2026</link><description>${'This study reports measured scientific evidence and experimental methods. '.repeat(8)}</description></item></channel></rss>`;
  const collect = options => realCollect({...options,fetchPage:async url=>({html:feed,finalUrl:url})});
  const first = await executeOperation(cmd('crawl',{sourceId:'a'}),{...f,collect});
  const second = await executeOperation({...cmd('crawl',{sourceId:'a'}),requestId:'test-request-second'},{...f,collect});
  assert.equal(first.inserted,1); assert.equal(second.inserted,0);
  assert.equal(fs.readdirSync(path.join(f.root,'data/raw')).filter(n=>n.endsWith('.json')).length,1);
  assert.equal(f.readJson(f.pub('articles')).items[0].analysisStatus,'pending');
  assert.deepEqual(fs.readFileSync(f.pub('meta')),beforeMeta);
  assert.equal(f.readJson(f.pub('sources')).items.length,3);
  assert.equal(f.readJson(f.pub('sources')).items[2].enabled,false);
});
test('multi-batch manual crawl retains every source and restores scheduled state', async t => {
  const f=fixture(t), all=Array.from({length:27},(_,i)=>({...sources[0],id:`s-${i}`,sourceKey:`s-${i}`}));
  f.writeJson(f.pub('sources'),{items:all});let batches=0;
  const collect=async({seeds})=>{batches++;assert.ok(seeds.length<=12);f.writeJson(f.pub('sources'),{items:seeds.map(s=>({...s,crawlStatus:'ok'}))});f.writeJson(f.pub('meta'),{cursor:0});return {processed:seeds.length,succeeded:seeds.length};};
  const run=await executeOperation(cmd('crawl_all'),{...f,collect});
  assert.equal(batches,3);assert.equal(run.processed,27);assert.equal(f.readJson(f.pub('meta')).cursor,77);
  assert.equal(f.readJson(f.pub('sources')).items.filter(s=>s.crawlStatus==='ok').length,27);
});

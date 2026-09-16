import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Download, ExternalLink, FlaskConical, Loader2, RefreshCw, Rss } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CrawlStatusBadge } from '@/components/ai4s-badges';
import { HealthCheckPanel } from './HealthCheckPanel';
import { formatDateTime } from '@/lib/format';
import type { IAi4sSource, IAi4sHealthCheckStats } from '@shared/api.interface';
import { loadSourceSnapshot, newSourceDraft, readDrafts, saveDrafts, SOURCE_ACTIONS_URL, type SourceAction, type SourceDraft, type SourceReceipt } from '@/api/sourceOperations';

const failures = new Set(['invalid_url','robots_blocked','timeout','network_error','parse_failed','needs_config','failed']);
const date = (value?: string | null) => value ? formatDateTime(Date.parse(value)) : '—';
const strategy: Record<string,string> = {auto:'自动',rss:'RSS / Atom',sitemap:'Sitemap',entry:'会议 / 活动入口',crawler:'网页兜底',disabled:'不可抓取 / 需配置'};
function Row({label,children}:{label:string;children:ReactNode}) { return <div className="flex justify-between gap-4 border-b py-2"><span className="shrink-0 text-xs text-muted-foreground">{label}</span><span className="break-all text-right text-sm">{children || '—'}</span></div>; }
function Link({url}:{url?:string|null}) { return url && /^https?:\/\//i.test(url) ? <a className="text-primary hover:underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a> : <span>—</span>; }

export default function SourcesPage() {
  const [sources,setSources] = useState<IAi4sSource[]>([]);
  const [health,setHealth] = useState<IAi4sHealthCheckStats|null>(null);
  const [receipts,setReceipts] = useState<SourceReceipt[]>([]);
  const [drafts,setDrafts] = useState<SourceDraft[]>(readDrafts);
  const [draft,setDraft] = useState<SourceDraft|null>(null);
  const [detailId,setDetailId] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [updatedAt,setUpdatedAt] = useState('');
  const [group,setGroup] = useState('all');
  const [region,setRegion] = useState('all');
  const [priority,setPriority] = useState('all');
  const [status,setStatus] = useState('all');
  const [search,setSearch] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const data = await loadSourceSnapshot(); setSources(data.sources.items); setHealth(data.health.stats); setReceipts(data.receipts.items); setUpdatedAt(data.sources.updatedAt || ''); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{ void refresh(); },[refresh]);
  const pending = useMemo(()=>drafts.filter(d=>!receipts.some(r=>r.requestId===d.command.requestId)),[drafts,receipts]);
  useEffect(()=>{
    if (!pending.length) return;
    const timer = window.setInterval(()=>{if(document.visibilityState==='visible') void refresh();},60000);
    const focus = ()=>void refresh(); window.addEventListener('focus',focus);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};
  },[pending.length,refresh]);
  const prepare = (action:SourceAction,label:string,source?:IAi4sSource,enabled?:boolean) => {
    const value = newSourceDraft(action,label,source?.sourceKey,enabled); setDetailId(null); setDraft(value);
  };
  const remember = (value:SourceDraft) => {
    const next = [value,...drafts.filter(d=>d.command.requestId!==value.command.requestId)].slice(0,20);
    setDrafts(next); saveDrafts(next);
    toast.info('请求页面已打开；请在 GitHub 点击提交。尚未确认任务已启动。');
  };
  const dismiss = (id:string) => { const next = drafts.filter(d=>d.command.requestId!==id); setDrafts(next);saveDrafts(next); };
  const filtered = useMemo(()=>sources.filter(s=>(group==='all'||s.groupName===group)&&(region==='all'||s.region===region)&&(priority==='all'||s.priority===priority)&&(status==='all'||(status==='failed'?failures.has(s.crawlStatus):status==='disabled'?!s.enabled:s.crawlStatus===status))&&(!search.trim()||[s.name,s.directions,s.products,s.representative,s.wechat,s.sourceKey].some(v=>(v||'').toLowerCase().includes(search.trim().toLowerCase())))),[sources,group,region,priority,status,search]);
  const detail = sources.find(s=>s.sourceKey===detailId);
  const failedCount = sources.filter(s=>s.enabled&&s.crawlStrategy!=='disabled'&&failures.has(s.crawlStatus)).length;
  const exportCsv = () => {
    const fields: (keyof IAi4sSource)[] = ['sourceKey','name','groupName','type','region','directions','website','wechat','feedUrl','priority','enabled','crawlStatus','lastCrawlAt','lastCheckAt','lastDiagnostic'];
    const escape = (value:unknown) => { let text=String(value??''); if(/^[=+@\-\t\r]/.test(text)) text=`'${text}`;return `"${text.replace(/"/g,'""')}"`; };
    const text = '\uFEFF'+[fields.join(','),...filtered.map(s=>fields.map(k=>escape(s[k])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ai4s-monitor-sources.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="space-y-4">
    <Card><CardContent className="space-y-2 pt-5 text-sm">
      <p className="font-medium">GitHub 原生来源管理</p>
      <p className="text-muted-foreground">操作会先生成 GitHub Issue 请求；在 GitHub 确认提交后，由 Actions 验证仓库写入权限并执行。前端不保存 Token。原每六小时自动抓取保持不变。</p>
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" onClick={()=>void refresh()} disabled={loading}>{loading?<Loader2 className="size-4 animate-spin"/>:<RefreshCw className="size-4"/>}刷新结果</Button><a className="text-primary hover:underline" href={SOURCE_ACTIONS_URL} target="_blank" rel="noopener noreferrer">查看 Actions / 恢复未处理请求 <ExternalLink className="inline size-3"/></a><span className="text-xs text-muted-foreground">数据时间：{date(updatedAt)}</span></div>
      {error&&<p role="alert" className="text-destructive">{error}</p>}
    </CardContent></Card>
    <HealthCheckPanel stats={health} running={false} onStart={()=>prepare('health_check','全部来源健康检查')}/>
    <Card><CardHeader className="pb-3"><CardTitle className="text-sm">来源筛选</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {([{label:'清单分组',value:group,set:setGroup,items:[...new Set(sources.map(s=>s.groupName))]}, {label:'国家 / 地区',value:region,set:setRegion,items:[...new Set(sources.map(s=>s.region))]}, {label:'优先级',value:priority,set:setPriority,items:['高','中','低']}] as const).map(f=><div key={f.label} className="space-y-1"><label className="text-xs text-muted-foreground">{f.label}</label><Select value={f.value} onValueChange={f.set}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部</SelectItem>{f.items.filter(Boolean).map(i=><SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent></Select></div>)}
      <div className="space-y-1"><label className="text-xs text-muted-foreground">状态</label><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="failed">仅失败</SelectItem><SelectItem value="ok">成功</SelectItem><SelectItem value="no_content">无可解析内容</SelectItem><SelectItem value="disabled">已停用</SelectItem><SelectItem value="idle">未检查</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><label className="text-xs text-muted-foreground">名称 / 方向 / 公众号</label><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="如：药物 / 材料"/></div>
    </CardContent></Card>
    <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-sm">监控来源清单（{filtered.length}/{sources.length}）</CardTitle><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>导出筛选结果</Button><Button size="sm" variant="outline" disabled={!failedCount} onClick={()=>prepare('retry_failed',`重试失败来源（${failedCount} 个；以执行时状态为准）`)}>重试失败来源（{failedCount}）</Button><Button size="sm" variant="outline" onClick={()=>prepare('health_check','全部来源健康检查')}><FlaskConical className="size-4"/>全部测试</Button><Button size="sm" onClick={()=>prepare('crawl_all','抓取全部已启用来源')}><Download className="size-4"/>全部抓取</Button></div></div></CardHeader>
      <CardContent className="overflow-x-auto p-0"><Table><TableHeader><TableRow>{['主体名称','主体类型','国家 / 地区','研究方向','核心产品 / 平台','代表人物','优先级','启用','最近抓取','状态','操作'].map(h=><TableHead className="whitespace-nowrap" key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>
        {!filtered.length&&<TableRow><TableCell colSpan={11} className="h-24 text-center text-muted-foreground">{loading?'正在加载来源…':'没有符合条件的来源'}</TableCell></TableRow>}
        {filtered.map(s=><TableRow key={s.sourceKey}><TableCell><button className="max-w-[180px] truncate text-left font-medium hover:text-primary" onClick={()=>setDetailId(s.sourceKey)}>{s.name}</button></TableCell><TableCell className="text-xs">{s.type}</TableCell><TableCell className="text-xs">{s.region}</TableCell><TableCell><span className="block max-w-[150px] truncate text-xs" title={s.directions}>{s.directions}</span></TableCell><TableCell><span className="block max-w-[130px] truncate text-xs">{s.products||'—'}</span></TableCell><TableCell className="text-xs">{s.representative||'—'}</TableCell><TableCell><Badge variant={s.priority==='高'?'default':'outline'}>{s.priority}</Badge></TableCell><TableCell><Switch checked={s.enabled} onCheckedChange={enabled=>prepare('set_enabled',`${enabled?'启用':'停用'}：${s.name}`,s,enabled)} aria-label={`启用或停用 ${s.name}`}/></TableCell><TableCell className="whitespace-nowrap text-xs">{date(s.lastCrawlAt)}</TableCell><TableCell><CrawlStatusBadge status={s.crawlStatus}/></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>prepare('health_check',`检测：${s.name}`,s)}>检测</Button><Button size="sm" variant="outline" disabled={!s.enabled||s.crawlStrategy==='disabled'} onClick={()=>prepare('crawl',`抓取：${s.name}`,s)}>{failures.has(s.crawlStatus)?'重新抓取':'抓取'}</Button></div></TableCell></TableRow>)}
      </TableBody></Table></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">操作请求与执行结果</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      {pending.map(d=><div key={d.command.requestId} className="rounded border p-3"><p>{d.label}</p><p className="mt-1 text-xs text-muted-foreground">尚未收到执行结果。请确认已在 GitHub 提交；这里不把打开页面视为任务已启动。</p><div className="mt-2 flex gap-3"><a className="text-primary hover:underline" href={d.url} target="_blank" rel="noopener noreferrer">打开请求（已提交请勿重复）</a><button className="text-muted-foreground" onClick={()=>dismiss(d.command.requestId)}>移除此提示</button></div></div>)}
      {receipts.slice(0,10).map(r=><div key={r.requestId} className="rounded border p-3"><div className="flex flex-wrap justify-between gap-2"><span>{r.status==='success'?'已执行':r.status==='partial'?'部分来源失败':'执行失败'} · {date(r.finishedAt)}</span><div className="flex gap-3"><a className="text-primary" href={r.issueUrl} target="_blank" rel="noopener noreferrer">请求 #{r.issueNumber}</a><a className="text-primary" href={r.runUrl} target="_blank" rel="noopener noreferrer">Actions 日志</a></div></div><p className="mt-2 text-muted-foreground">{r.detail}</p></div>)}
      {!pending.length&&!receipts.length&&<p className="text-muted-foreground">暂无操作记录。请求执行并写入仓库后会显示结果。</p>}
    </CardContent></Card>
    <Dialog open={!!draft} onOpenChange={open=>{if(!open)setDraft(null);}}><DialogContent><DialogHeader><DialogTitle>确认操作请求</DialogTitle><DialogDescription>下一步在 GitHub 登录并提交 Issue；仅生成请求还不会执行。</DialogDescription></DialogHeader>{draft&&<div className="space-y-4"><p className="font-medium">{draft.label}</p><p className="text-sm text-muted-foreground">启停结果以服务器执行后的数据为准。检测不抓正文；抓取也不会被误报为 AI 分析完成。定时抓取计划和轮询位置不变。</p><Button asChild><a href={draft.url} target="_blank" rel="noopener noreferrer" onClick={()=>{remember(draft);setDraft(null);}}>前往 GitHub 提交请求 <ExternalLink className="size-4"/></a></Button></div>}</DialogContent></Dialog>
    <Dialog open={!!detail} onOpenChange={open=>{if(!open)setDetailId(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">{detail&&<><DialogHeader><DialogTitle className="flex items-center gap-2"><Rss className="size-4"/>{detail.name}</DialogTitle><DialogDescription>{detail.groupName} · {detail.type} · {detail.region}</DialogDescription></DialogHeader><div>
      <Row label="来源编号">{detail.sourceKey}</Row><Row label="AI4S 研究方向">{detail.directions}</Row><Row label="核心产品 / 平台">{detail.products}</Row><Row label="代表人物 / 负责人">{detail.representative}</Row><Row label="优先级">{detail.priority}</Row><Row label="官方网站"><Link url={detail.website}/></Row><Row label="官方公众号">{detail.wechat}</Row><Row label="LinkedIn"><Link url={detail.linkedin}/></Row><Row label="GitHub"><Link url={detail.github}/></Row><Row label="RSS / 会议链接"><Link url={detail.feedUrl}/></Row><Row label="备注">{detail.notes}</Row><Row label="抓取状态"><CrawlStatusBadge status={detail.crawlStatus}/></Row><Row label="抓取策略">{strategy[detail.crawlStrategy]||detail.crawlStrategy}</Row><Row label="发现的订阅地址"><Link url={detail.discoveredFeedUrl}/></Row><Row label="最近抓取时间">{date(detail.lastCrawlAt)}</Row><Row label="最后成功抓取">{date(detail.lastSuccessAt)}</Row><Row label="最近检查">{date(detail.lastCheckAt)}</Row><Row label="诊断与修复建议">{detail.lastDiagnostic}</Row><Row label="失败原因">{detail.lastError}</Row>
    </div><div className="flex gap-2"><Button variant="outline" onClick={()=>prepare('health_check',`检测：${detail.name}`,detail)}>重新检测</Button><Button disabled={!detail.enabled||detail.crawlStrategy==='disabled'} onClick={()=>prepare('crawl',`抓取：${detail.name}`,detail)}>重新抓取</Button></div></>}</DialogContent></Dialog>
  </div>;
}

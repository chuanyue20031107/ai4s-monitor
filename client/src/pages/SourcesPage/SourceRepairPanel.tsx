import type { IAi4sSource, ISourceDiagnostic } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FlaskConical, Wrench } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

const eligible = new Set(['network_error', 'timeout', 'failed']);
const labels: Record<string, string> = {
  cloudflare_blocked: 'Cloudflare 验证拦截', robots_blocked: 'robots 禁止访问', timeout: '网页超时',
  dns_error: 'DNS 解析失败', https_error: 'HTTPS / 证书异常', network_error: '网络异常',
  no_public_entry: '未发现 RSS / Sitemap', discovery_inconclusive: '入口探测未完成',
  needs_config: '需人工配置', invalid_url: '地址无效', parse_failed: '响应无法解析',
};
const checks: Record<string, string> = {ok:'正常',failed:'失败',not_checked:'未检测',allowed:'允许',blocked:'禁止',unavailable:'无法读取',available:'已验证',not_found:'未发现',inconclusive:'未确认'};
export const failureLabel = (value: string) => labels[value] || (value.startsWith('http_') ? `HTTP ${value.slice(5)}` : value || '待诊断');

export function SourceRepairPanel({ sources, diagnostics, loading, onDiagnose, onRepair }: {
  sources: IAi4sSource[]; diagnostics: ISourceDiagnostic[]; loading: boolean; onDiagnose: () => void; onRepair: () => void;
}) {
  const failed = sources.filter(s => eligible.has(s.crawlStatus));
  const available = failed.filter(s => s.enabled && s.crawlStrategy !== 'disabled' && s.autoRepairAvailable);
  const byId = new Map(diagnostics.map(d => [d.sourceKey, d]));
  return <Card>
    <CardHeader className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-sm">来源问题修复 · 失败来源（{failed.length}）</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={loading || !failed.length} onClick={onDiagnose}><FlaskConical className="size-4"/>自动诊断</Button>
          <Button size="sm" disabled={loading || !available.length} onClick={onRepair}><Wrench className="size-4"/>自动修复可用来源（{available.length}）</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">先诊断 network_error / timeout / failed，再验证并切换 RSS 或 Sitemap。修复入口后重新抓取，成功后才清除失败状态。未发现入口的来源保留人工处理。</p>
    </CardHeader>
    <CardContent className="max-h-[420px] overflow-auto p-0">
      <Table><TableHeader><TableRow><TableHead>来源</TableHead><TableHead>问题 / 检查结果</TableHead><TableHead>修复方式</TableHead><TableHead>诊断时间</TableHead></TableRow></TableHeader>
        <TableBody>{failed.map(s => {
          const d = byId.get(s.sourceKey), endpoint = d?.rss || d?.sitemap;
          return <TableRow key={s.sourceKey}>
            <TableCell className="min-w-36 font-medium">{s.name}{!s.enabled && <span className="block text-xs text-muted-foreground">已停用 · 不自动修复</span>}</TableCell>
            <TableCell className="min-w-52"><span>{failureLabel(s.failureType || d?.failureType || d?.diagnosis || '')}</span>
              {d && <span className="mt-1 block text-xs text-muted-foreground">DNS {checks[d.checks.dns] || d.checks.dns} · HTTPS {checks[d.checks.https] || d.checks.https}<br/>robots {checks[d.checks.robots] || d.checks.robots} · HTTP {d.checks.httpStatus ?? '未取得'}</span>}
            </TableCell>
            <TableCell className="min-w-40">{endpoint && /^https?:\/\//i.test(endpoint) ? <a className="underline underline-offset-4" href={endpoint} target="_blank" rel="noopener noreferrer">{d?.rss ? 'RSS / Atom' : 'Sitemap'}</a> : d ? '人工配置' : '等待诊断'}
              <span className="mt-1 block text-xs text-muted-foreground">{s.repairSuggestion === 'recrawl' ? '已切换入口 · 等待重抓' : s.autoRepairAvailable ? '已验证 · 可自动修复' : s.repairSuggestion === 'diagnose_again' ? '需重新诊断' : d?.repairStatus === 'validation_failed' ? '验证失败 · 未切换' : ''}</span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{d ? formatDateTime(Date.parse(d.checkedAt)) : '—'}</TableCell>
          </TableRow>;
        })}{!failed.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">{loading ? '正在读取来源…' : '没有待诊断的失败来源'}</TableCell></TableRow>}</TableBody>
      </Table>
    </CardContent>
  </Card>;
}

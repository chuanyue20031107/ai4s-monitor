import { useMemo, useState } from 'react';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunStatusBadge } from '@/components/ai4s-badges';
import { formatDateTime } from '@/lib/format';
import { TASK_TYPES, type IRunRecord } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';

function durationLabel(run: IRunRecord): string {
  const ms = Math.max(0, run.endedAt - run.startedAt);
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunsPage() {
  const { runs } = useAi4s();
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detailRun, setDetailRun] = useState<IRunRecord | null>(null);

  const filtered = useMemo(
    () =>
      runs.filter((r) => {
        if (typeFilter !== 'all' && r.taskType !== typeFilter) return false;
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        return true;
      }),
    [runs, typeFilter, statusFilter],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">任务筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">任务类型</span>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">运行状态</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">运行记录（{filtered.length}）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">任务类型</TableHead>
                  <TableHead className="whitespace-nowrap">开始时间</TableHead>
                  <TableHead className="whitespace-nowrap">结束时间</TableHead>
                  <TableHead className="whitespace-nowrap">耗时</TableHead>
                  <TableHead className="whitespace-nowrap">处理</TableHead>
                  <TableHead className="whitespace-nowrap">成功</TableHead>
                  <TableHead className="whitespace-nowrap">失败</TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
                  <TableHead className="min-w-[160px] whitespace-nowrap">失败原因</TableHead>
                  <TableHead className="whitespace-nowrap text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-36">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <SearchX className="size-8" />
                        <span className="text-sm">暂无运行记录：执行来源抓取或文章分析后自动生成</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, 100).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">{run.taskType}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{formatDateTime(run.startedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{formatDateTime(run.endedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{durationLabel(run)}</TableCell>
                      <TableCell className="tabular-nums">{run.processed}</TableCell>
                      <TableCell className="tabular-nums text-primary">{run.succeeded}</TableCell>
                      <TableCell className="tabular-nums text-destructive">{run.failed}</TableCell>
                      <TableCell><RunStatusBadge status={run.status} /></TableCell>
                      <TableCell>
                        <span className="block max-w-[220px] truncate text-xs" title={run.failureReason ?? ''}>
                          {run.failureReason || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button variant="outline" size="sm" onClick={() => setDetailRun(run)}>
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detailRun} onOpenChange={(open) => !open && setDetailRun(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailRun && (
            <>
              <DialogHeader>
                <DialogTitle>{detailRun.taskType} · 运行详情</DialogTitle>
                <DialogDescription>
                  {formatDateTime(detailRun.startedAt)} → {formatDateTime(detailRun.endedAt)}（{durationLabel(detailRun)}）
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-lg font-bold tabular-nums">{detailRun.processed}</div>
                    <div className="text-xs text-muted-foreground">处理数量</div>
                  </div>
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-lg font-bold tabular-nums text-primary">{detailRun.succeeded}</div>
                    <div className="text-xs text-muted-foreground">成功数量</div>
                  </div>
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-lg font-bold tabular-nums text-destructive">{detailRun.failed}</div>
                    <div className="text-xs text-muted-foreground">失败数量</div>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">运行详情</div>
                  <p className="whitespace-pre-line break-all rounded-md bg-muted p-3 text-xs leading-relaxed">
                    {detailRun.detail}
                  </p>
                </div>
                {detailRun.failureReason && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">失败原因</div>
                    <p className="whitespace-pre-line break-all rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      {detailRun.failureReason}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">运行状态</span>
                  <RunStatusBadge status={detailRun.status} />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

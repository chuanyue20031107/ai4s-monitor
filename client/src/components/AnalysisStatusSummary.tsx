import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AnalysisStatusSummary({ total, analyzed, pending }: { total: number; analyzed: number; pending: number }) {
  const rate = total ? Math.round((analyzed / total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">AI分析覆盖状态</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-2xl font-bold">{analyzed}</div>
          <div className="text-xs text-muted-foreground">已分析</div>
        </div>
        <div>
          <div className="text-2xl font-bold">{pending}</div>
          <div className="text-xs text-muted-foreground">待分析</div>
        </div>
        <div>
          <div className="text-2xl font-bold">{rate}%</div>
          <div className="text-xs text-muted-foreground">覆盖率</div>
        </div>
      </CardContent>
    </Card>
  );
}

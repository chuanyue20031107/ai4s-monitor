import { Link } from 'react-router-dom';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ImportantBoardStatsProps {
  rangeLabel: string;
  newCount: number;
  keyCount: number;
  highTotal: number;
  enabledSources: number;
  totalSources: number;
}

export function ImportantBoardStats({
  rangeLabel,
  newCount,
  keyCount,
  highTotal,
  enabledSources,
  totalSources,
}: ImportantBoardStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{rangeLabel}新增情报</CardDescription>
          <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">{newCount}</CardTitle>
          {newCount === 0 && (
            <p className="text-xs text-muted-foreground">
              服务端每日定时自动抓取，也可到「
              <Link to="/sources" className="text-primary hover:underline">监控来源</Link>」手动抓取，或在「
              <Link to="/settings" className="text-primary hover:underline">设置</Link>」提交链接
            </p>
          )}
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{rangeLabel}重点情报（评分 5）</CardDescription>
          <CardTitle className="text-3xl font-bold tabular-nums tracking-tight text-primary">
            {keyCount}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>高重要性文章（评分 5）</CardDescription>
          <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">{highTotal}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>已监控主体</CardDescription>
          <CardTitle className="text-3xl font-bold tabular-nums tracking-tight">
            {enabledSources}
            <span className="text-base font-normal text-muted-foreground"> / {totalSources}</span>
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

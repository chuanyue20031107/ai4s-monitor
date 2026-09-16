import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface ISourceCommandResult {
  commandId: string;
  action: string;
  sourceId: string | null;
  status: string;
  receivedAt: string;
  note?: string;
}

export function SourceCommandPanel({ items }: { items: ISourceCommandResult[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">来源操作执行状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无来源操作任务</div>
        ) : (
          items.map((item) => (
            <div key={item.commandId} className="rounded border p-3 text-sm">
              <div>操作：{item.action}</div>
              <div>来源：{item.sourceId ?? '-'}</div>
              <div>状态：{item.status}</div>
              <div className="text-xs text-muted-foreground">{item.receivedAt}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

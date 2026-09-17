import { useState } from 'react';
import { Bot, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export default function AIControlPage() {
  const [command, setCommand] = useState('');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="size-4" /> AI分析控制中心
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            用于提交AI4S情报分析任务。任务将进入GitHub Native任务队列，不在前端保存任何凭据。
          </p>
          <Textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如：分析最近100条材料科学情报"
          />
          <Button disabled={!command.trim()}>
            <Play className="size-4" />
            提交分析任务
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

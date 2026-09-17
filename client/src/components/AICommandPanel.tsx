import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export function AICommandPanel() {
  const [command, setCommand] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">AI任务控制中心</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="输入AI分析任务，例如：分析最近100条材料科学情报"
        />
        <Button disabled={!command.trim()}>
          提交AI任务
        </Button>
      </CardContent>
    </Card>
  );
}

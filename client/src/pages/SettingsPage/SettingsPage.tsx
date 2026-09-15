import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CATEGORIES, SOURCE_SEED, WEEKDAY_OPTIONS, type ISettings } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';

const RETENTION_OPTIONS = [
  { value: 30, label: '保留 30 天' },
  { value: 90, label: '保留 90 天' },
  { value: 180, label: '保留 180 天' },
  { value: 365, label: '保留 365 天' },
];

const PUSH_TIME_OPTIONS = Array.from({ length: 25 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

const CONCURRENCY_OPTIONS = [2, 4, 6, 8];
const RETRY_OPTIONS = [0, 1, 2, 3];
const TIMEOUT_OPTIONS = [10, 20, 30, 60];

function formatTime(ts: number | null): string {
  if (!ts) return '尚未运行';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export default function SettingsPage() {
  const {
    settings,
    sourceRuntime,
    busy,
    loaded,
    lastRunAt,
    lastPushAt,
    toggleSource,
    saveSettings,
    analyzeUrl,
  } = useAi4s();
  const [form, setForm] = useState<ISettings>({ ...settings });
  const [manualUrl, setManualUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded) setForm({ ...settings });
    // 仅在首次数据加载完成后同步一次，避免覆盖用户编辑中表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const analyzing = busy['analyze:url'];

  const handleManualCrawl = async (e: FormEvent) => {
    e.preventDefault();
    const url = manualUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      toast.error('请输入以 http(s):// 开头的链接');
      return;
    }
    const ok = await analyzeUrl(url);
    if (ok) {
      setManualUrl('');
    }
  };

  const update = (patch: Partial<ISettings>) => setForm((prev) => ({ ...prev, ...patch }));

  const toggleFocusCategory = (category: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      focusCategories: checked
        ? [...prev.focusCategories, category as ISettings['focusCategories'][number]]
        : prev.focusCategories.filter((c) => c !== category),
    }));
  };

  const handleSave = async () => {
    const receivers = form.feishuReceivers.map((r) => r.trim()).filter(Boolean);
    const groupWebhookUrl = form.groupWebhookUrl.trim();
    if (groupWebhookUrl && !/^https?:\/\//.test(groupWebhookUrl)) {
      toast.error('群机器人 Webhook 需以 http(s):// 开头');
      return;
    }
    if (!PUSH_TIME_OPTIONS.includes(form.pushTime)) {
      toast.error('推送时间需为半小时粒度（如 18:00 / 18:30），请重新选择');
      return;
    }
    setSaving(true);
    try {
      await saveSettings({ ...form, feishuReceivers: receivers, groupWebhookUrl });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 手动抓取 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">手动抓取情报</CardTitle>
          <CardDescription>
            粘贴任意文章或来源页链接，立即抓取并 AI 分析入库（单篇约 30 秒～2 分钟）；也可前往「监控来源」页对种子来源执行抓取
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleManualCrawl} className="flex gap-2">
            <Input
              type="url"
              placeholder="https://example.com/article"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              disabled={analyzing}
            />
            <Button type="submit" className="shrink-0" disabled={analyzing}>
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {analyzing ? '抓取中…' : '抓取并分析'}
            </Button>
          </form>
          {analyzing && (
            <p className="mt-2 text-xs text-muted-foreground">
              正在抓取并分析，完成后将自动入库到「情报列表」…
            </p>
          )}
        </CardContent>
      </Card>

      {/* 服务端自动任务 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">服务端自动任务</CardTitle>
          <CardDescription>
            由服务端定时触发器 <code className="rounded bg-muted px-1 text-xs">daily_ai4s_digest</code> 每 30
            分钟轮询一次，按下方配置自动执行「抓取 → 去重 → 分类 → AI 分析 → 每日摘要 → 飞书推送」全链路，无需打开应用
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-md border p-3 text-xs text-muted-foreground md:grid-cols-2">
            <span>上次任务运行：{formatTime(lastRunAt)}</span>
            <span>上次飞书推送：{formatTime(lastPushAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">每日定时抓取</span>
              <p className="text-xs text-muted-foreground">关闭后触发器空转，不再抓取新情报</p>
            </div>
            <Switch
              checked={form.dailyCrawlEnabled}
              onCheckedChange={(checked) => update({ dailyCrawlEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">每日摘要飞书推送</span>
              <p className="text-xs text-muted-foreground">按推送时间将每日摘要发送至飞书</p>
            </div>
            <Switch
              checked={form.dailyPushEnabled}
              onCheckedChange={(checked) => update({ dailyPushEnabled: checked })}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">推送时间（半小时粒度）</span>
            <Select
              value={form.pushTime}
              onValueChange={(v) => update({ pushTime: v })}
            >
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PUSH_TIME_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">每周情报周报</span>
              <p className="text-xs text-muted-foreground">
                周报日在每日推送时间一并生成并推送（仅重点情报与趋势观察）
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.weeklyReportEnabled}
                onCheckedChange={(checked) => update({ weeklyReportEnabled: checked })}
              />
              <Select
                value={form.weeklyReportDay}
                onValueChange={(v) => update({ weeklyReportDay: v })}
                disabled={!form.weeklyReportEnabled}
              >
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">抓取并发数</span>
              <Select
                value={String(form.concurrency)}
                onValueChange={(v) => update({ concurrency: Number(v) })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONCURRENCY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} 路</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">单来源重试次数</span>
              <Select
                value={String(form.retryCount)}
                onValueChange={(v) => update({ retryCount: Number(v) })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RETRY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} 次</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">单请求超时（秒）</span>
              <Select
                value={String(form.timeoutSeconds)}
                onValueChange={(v) => update({ timeoutSeconds: Number(v) })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEOUT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} 秒</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">真实作用于服务端每日抓取任务</p>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">飞书接收配置（用户 ID，逗号或换行分隔）</span>
            <Textarea
              rows={3}
              placeholder={'user_id_1\nuser_id_2'}
              value={form.feishuReceivers.join('\n')}
              onChange={(e) => update({ feishuReceivers: e.target.value.split(/[\n，,]+/) })}
            />
            <p className="text-xs text-muted-foreground">
              当前已配置 {form.feishuReceivers.filter((r) => r.trim()).length} 位接收人
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">飞书群机器人 Webhook（群设置 → 群机器人 → 添加自定义机器人）</span>
            <Input
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
              value={form.groupWebhookUrl}
              onChange={(e) => update({ groupWebhookUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              每日摘要将以飞书卡片推送到该群；自定义机器人不受应用可见范围限制，无需拉应用机器人入群
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 抓取配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">抓取配置</CardTitle>
          <CardDescription>控制情报抓取的时间窗口与关注范围</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">抓取时间窗口（起）</span>
              <Input
                type="time"
                value={form.crawlWindowStart}
                onChange={(e) => update({ crawlWindowStart: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">抓取时间窗口（止）</span>
              <Input
                type="time"
                value={form.crawlWindowEnd}
                onChange={(e) => update({ crawlWindowEnd: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">最低重要性评分</span>
            <Select
              value={String(form.minScore)}
              onValueChange={(v) => update({ minScore: Number(v) })}
            >
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} 分及以上</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">关注分类</span>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {CATEGORIES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={form.focusCategories.includes(c)}
                    onCheckedChange={(checked) => toggleFocusCategory(c, checked === true)}
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 来源启用/停用 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">来源启用 / 停用</CardTitle>
          <CardDescription>停用后的来源不再参与每日定时抓取与推送（写入数据库，立即生效）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {SOURCE_SEED.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{source.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {source.type} · {source.region} · 优先级 {source.priority}
                  </div>
                </div>
                <Switch
                  checked={sourceRuntime[source.id]?.enabled ?? true}
                  onCheckedChange={() => void toggleSource(source.id)}
                  aria-label={`启用或停用 ${source.name}`}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 数据保留策略 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">数据保留策略</CardTitle>
          <CardDescription>超过保留期限的情报文章将在每日任务中自动清理</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={String(form.retentionDays)}
            onValueChange={(v) => update({ retentionDays: Number(v) })}
          >
            <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存设置
        </Button>
      </div>
    </div>
  );
}

/**
 * 仪表盘轻量看板：7 天趋势 / 分类分布 / 评分分布（基于已有文章数据，无 mock）
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORIES, type IArticle } from '@/data/ai4s';

const TEAL = '#157f5f';
const MUTED = '#94a3b8';

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

/** 看板 1：最近 7 天情报趋势（按抓取时间统计，点击柱形跳转文章列表带日期筛选） */
export function Trend7DaysChart({ articles }: { articles: IArticle[] }) {
  const navigate = useNavigate();
  const { days, counts, total } = useMemo(() => {
    const dayList: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      dayList.push(format(new Date(Date.now() - i * 86400000), 'yyyy-MM-dd'));
    }
    const byDay = new Map<string, number>();
    for (const a of articles) {
      const key = format(new Date(a.crawledAt), 'yyyy-MM-dd');
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const countList = dayList.map((d) => byDay.get(d) ?? 0);
    return { days: dayList, counts: countList, total: countList.reduce((s, v) => s + v, 0) };
  }, [articles]);

  const option: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: days, boundaryGap: true },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        data: counts,
        barMaxWidth: 36,
        itemStyle: { color: TEAL },
        cursor: 'pointer',
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">最近 7 天情报趋势</CardTitle>
        <CardDescription>按抓取时间统计每日新增情报 · 点击柱形跳转文章列表</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ChartEmpty text="暂无最近 7 天情报数据" />
        ) : (
          <ReactECharts
            option={option}
            theme="ud"
            className="h-[300px]"
            onEvents={{
              click: (params: CallbackDataParams) =>
                navigate(`/articles?date=${String(params.name)}`),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** 看板 2：情报分类分布（横向柱状图，点击跳转文章列表带分类筛选） */
export function CategoryDistChart({ articles }: { articles: IArticle[] }) {
  const navigate = useNavigate();
  const { rows, total } = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const a of articles) {
      const key = a.category || '其他';
      byCat.set(key, (byCat.get(key) ?? 0) + 1);
    }
    const list = CATEGORIES.map((c) => ({ name: c, count: byCat.get(c) ?? 0 }));
    list.sort((x, y) => y.count - x.count);
    return { rows: list, total: list.reduce((s, r) => s + r.count, 0) };
  }, [articles]);

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      formatter: (p: CallbackDataParams) => {
        const row = rows.find((r) => r.name === p.name);
        const pct = total > 0 && row ? Math.round((row.count / total) * 100) : 0;
        return `${p.name}：${row?.count ?? 0} 篇（${pct}%）`;
      },
    },
    grid: { left: '3%', right: '12%', top: '5%', bottom: '5%', containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: rows.map((r) => r.name) },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => r.count),
        barMaxWidth: 22,
        itemStyle: { color: TEAL },
        cursor: 'pointer',
        label: {
          show: true,
          position: 'right',
          formatter: (p: CallbackDataParams) => String(p.value),
        },
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">情报分类分布</CardTitle>
        <CardDescription>当前筛选范围内各分类数量与占比 · 点击分类跳转文章列表</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ChartEmpty text="暂无分类数据" />
        ) : (
          <ReactECharts
            option={option}
            theme="ud"
            className="h-[300px]"
            onEvents={{
              click: (params: CallbackDataParams) =>
                navigate(`/articles?category=${encodeURIComponent(String(params.name))}`),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** 看板 3：情报重要性分布（评分 1-5 数量柱状图，点击跳转带评分筛选） */
export function ScoreDistChart({ articles }: { articles: IArticle[] }) {
  const navigate = useNavigate();
  const { counts, keyCount } = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const a of articles) {
      if (a.score >= 1 && a.score <= 5) {
        buckets[a.score - 1] += 1;
      }
    }
    return { counts: buckets, keyCount: buckets[3] + buckets[4] };
  }, [articles]);

  const labels = ['1 星', '2 星', '3 星', '4 星', '5 星'];
  const option: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: labels, boundaryGap: true },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        data: counts.map((v, i) => ({
          value: v,
          itemStyle: { color: i >= 3 ? TEAL : MUTED },
        })),
        barMaxWidth: 36,
        cursor: 'pointer',
      },
    ],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">情报重要性分布</CardTitle>
        <CardDescription>
          评分 1-5 数量分布 · 重点情报（评分 4-5）共 {keyCount} 篇 · 点击评分跳转文章列表
        </CardDescription>
      </CardHeader>
      <CardContent>
        {counts.every((c) => c === 0) ? (
          <ChartEmpty text="暂无已分析评分数据" />
        ) : (
          <ReactECharts
            option={option}
            theme="ud"
            className="h-[300px]"
            onEvents={{
              click: (params: CallbackDataParams) =>
                navigate(`/articles?score=${Number(params.dataIndex) + 1}`),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

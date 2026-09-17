import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  RotateCcw,
  SearchX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import {
  AnalysisStatusBadge,
  CategoryBadge,
  ContentTypeBadge,
  MoatTagBadges,
  ScoreBadge,
} from '@/components/ai4s-badges';
import { dateStrToTs, formatShortDateTime } from '@/lib/format';
import { CATEGORIES, CONTENT_TYPES, SOURCE_GROUPS, SOURCE_SEED } from '@/data/ai4s';
import { useAi4s } from '@/store/Ai4sStore';

const PAGE_SIZE = 10;

const ANALYSIS_STATUS_OPTIONS = [
  { value: 'awaiting', label: '待AI分析（待处理 / 分析中）' },
  { value: 'pending', label: '待处理' },
  { value: 'analyzing', label: '分析中' },
  { value: 'done', label: 'AI已分析' },
  { value: 'failed', label: '失败' },
];

export default function ArticlesPage() {
  const { articles, refreshAll, loaded, loadError } = useAi4s();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 筛选状态
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [category, setCategory] = useState('all');
  const [sourceId, setSourceId] = useState('all');
  const [sourceType, setSourceType] = useState('all');
  const sourceGroupById = useMemo(
    () => Object.fromEntries(SOURCE_SEED.map((s) => [s.id, s.group])),
    [],
  );
  const [region, setRegion] = useState('all');
  const [minScore, setMinScore] = useState('all');
  const [contentType, setContentType] = useState('all');
  const [analysisStatus, setAnalysisStatus] = useState('all');
  const [sortField, setSortField] = useState<'publishedAt' | 'score' | 'crawledAt'>('publishedAt');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);

  // 快捷入口 preset / 看板跳转参数 → 筛选条件
  useEffect(() => {
    const preset = searchParams.get('preset');
    const dateParam = searchParams.get('date');
    const categoryParam = searchParams.get('category');
    const scoreParam = searchParams.get('score');
    const sourceParam = searchParams.get('source');
    if (!preset && !dateParam && !categoryParam && !scoreParam && !sourceParam) return;
    if (preset === 'today-key') {
      const today = format(new Date(), 'yyyy-MM-dd');
      setDateFrom(today);
      setDateTo(today);
      setMinScore('4');
    } else if (preset === 'conf') {
      setSourceType('学术会议与期刊');
    } else if (preset === 'model') {
      setCategory('模型');
    } else if (preset === 'lab') {
      setCategory('自动化实验室');
    }
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setDateFrom(dateParam);
      setDateTo(dateParam);
    }
    if (categoryParam && (CATEGORIES as readonly string[]).includes(categoryParam)) {
      setCategory(categoryParam);
    }
    if (scoreParam && ['1', '2', '3', '4', '5'].includes(scoreParam)) {
      setMinScore(scoreParam);
    }
    if (sourceParam && SOURCE_SEED.some((s) => s.id === sourceParam)) {
      setSourceId(sourceParam);
    }
    setPage(1);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const regions = useMemo(() => Array.from(new Set(SOURCE_SEED.map((s) => s.region))), []);
  const regionBySource = useMemo(
    () => Object.fromEntries(SOURCE_SEED.map((s) => [s.id, s.region])),
    [],
  );

  const filtered = useMemo(() => {
    const fromTs = dateStrToTs(dateFrom);
    const toTs = dateStrToTs(dateTo, true);
    const list = articles.filter((a) => {
      if (fromTs !== null && a.publishedAt < fromTs) return false;
      if (toTs !== null && a.publishedAt > toTs) return false;
      if (category !== 'all' && a.category !== category) {
        if (!(category === '其他' && !a.category)) return false;
      }
      if (sourceId !== 'all' && a.sourceId !== sourceId) return false;
      if (sourceType !== 'all' && sourceGroupById[a.sourceId] !== sourceType) return false;
      if (region !== 'all' && regionBySource[a.sourceId] !== region) return false;
      if (minScore !== 'all' && a.score < Number(minScore)) return false;
      if (contentType !== 'all' && a.contentType !== contentType) return false;
      if (analysisStatus === 'awaiting' && !['pending', 'analyzing'].includes(a.analysisStatus)) return false;
      if (analysisStatus !== 'all' && analysisStatus !== 'awaiting' && a.analysisStatus !== analysisStatus) return false;
      return true;
    });
    return [...list].sort((x, y) => {
      const delta = sortField === 'score' ? x.score - y.score : x[sortField] - y[sortField];
      return sortDir === 'desc' ? -delta : delta;
    });
  }, [
    articles, dateFrom, dateTo, category, sourceId, sourceType, region, minScore,
    contentType, analysisStatus, sortField, sortDir, regionBySource,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, category, sourceId, sourceType, region, minScore, contentType, analysisStatus, sortField, sortDir]);

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setCategory('all');
    setSourceId('all');
    setSourceType('all');
    setRegion('all');
    setMinScore('all');
    setContentType('all');
    setAnalysisStatus('all');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">情报文章</h1>
          <p className="mt-1 text-xs text-muted-foreground">待AI分析包含 pending / analyzing；分析中表示已分派至 ChatGPT 任务批次。</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void refreshAll()}>刷新文章</Button>
          <Button size="sm" onClick={() => navigate('/ai-control')}>AI 清仓 / 分析任务</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="分析状态分组">
        {[
          { value: 'all', label: '全部', count: articles.length },
          { value: 'done', label: 'AI已分析', count: articles.filter((a) => a.analysisStatus === 'done').length },
          { value: 'awaiting', label: '待AI分析', count: articles.filter((a) => ['pending', 'analyzing'].includes(a.analysisStatus)).length },
          { value: 'failed', label: '分析失败', count: articles.filter((a) => a.analysisStatus === 'failed').length },
        ].map((tab) => <Button key={tab.value} size="sm" variant={analysisStatus === tab.value ? 'default' : 'outline'}
          aria-pressed={analysisStatus === tab.value} onClick={() => setAnalysisStatus(tab.value)}>{tab.label}（{tab.count}）</Button>)}
      </div>
      {!loaded && <p className="text-sm text-muted-foreground">正在读取文章…</p>}
      {loadError && <p className="text-sm text-destructive" role="alert">{loadError}</p>}
      {/* 筛选区 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">发布日期（起）</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">发布日期（止）</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">分类</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">来源主体</span>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主体</SelectItem>
                {SOURCE_SEED.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">清单分组</span>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分组</SelectItem>
                {SOURCE_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">国家 / 地区</span>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部地区</SelectItem>
                {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">重要性评分 ≥</span>
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">不限</SelectItem>
                {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} 分</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">内容类型</span>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {CONTENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">分析状态</span>
            <Select value={analysisStatus} onValueChange={setAnalysisStatus}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {ANALYSIS_STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              重置筛选
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 列表 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">情报文章（{filtered.length}）</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={sortField} onValueChange={(v) => setSortField(v as typeof sortField)}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="publishedAt">按发布时间</SelectItem>
                <SelectItem value="crawledAt">按抓取时间</SelectItem>
                <SelectItem value="score">按重要性评分</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="切换排序方向"
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            >
              {sortDir === 'desc' ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px] whitespace-nowrap">标题</TableHead>
                  <TableHead className="whitespace-nowrap">来源主体</TableHead>
                  <TableHead className="whitespace-nowrap">主体类型</TableHead>
                  <TableHead className="whitespace-nowrap">分类</TableHead>
                  <TableHead className="whitespace-nowrap">发布时间</TableHead>
                  <TableHead className="whitespace-nowrap">评分</TableHead>
                  <TableHead className="whitespace-nowrap">内容类型</TableHead>
                  <TableHead className="whitespace-nowrap">护城河标签</TableHead>
                  <TableHead className="whitespace-nowrap">分析状态</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-40">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <SearchX className="size-8" />
                        <span className="text-sm">
                          {articles.length === 0
                            ? '暂无情报文章：请到「监控来源」执行抓取'
                            : '没有符合筛选条件的情报'}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/articles/${a.id}`)}>
                      <TableCell className="min-w-[260px]">
                        <span className="block max-w-[320px] truncate font-medium">{a.title}</span>
                        <span className="mt-0.5 block max-w-[320px] truncate text-xs text-muted-foreground">
                          {a.summary || '暂无摘要'}
                        </span>
                      </TableCell>
                      <TableCell><span className="block max-w-[140px] truncate">{a.sourceName}</span></TableCell>
                      <TableCell><span className="block max-w-[150px] truncate text-xs">{a.sourceType || '—'}</span></TableCell>
                      <TableCell><CategoryBadge category={a.category} /></TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{formatShortDateTime(a.publishedAt)}</TableCell>
                      <TableCell><ScoreBadge score={a.score} /></TableCell>
                      <TableCell><ContentTypeBadge contentType={a.contentType} /></TableCell>
                      <TableCell><MoatTagBadges tags={a.moatTags} /></TableCell>
                      <TableCell><AnalysisStatusBadge status={a.analysisStatus} /></TableCell>
                      <TableCell className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="size-8" aria-label="详情" onClick={() => navigate(`/articles/${a.id}`)}>
                            <Eye className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8" asChild>
                            <a href={a.url} target="_blank" rel="noreferrer" aria-label="原文链接">
                              <ExternalLink className="size-4" />
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              共 {filtered.length} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

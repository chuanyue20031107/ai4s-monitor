import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCw, Search, SearchX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORIES, SOURCE_SEED, type IArticle } from '@/data/ai4s';
import { todayStartTs } from '@/lib/format';
import { ImportantBoardStats } from './ImportantBoardStats';
import { ImportantPostCard } from './ImportantPostCard';

type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: 'all', label: '全部' },
];

const RANGE_LABEL: Record<RangeKey, string> = {
  today: '今日',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '累计',
};

const SCORE_OPTIONS = ['all', '1', '2', '3', '4', '5'] as const;

  const PAGE_SIZE = 5;

function rangeStartTs(range: RangeKey): number | null {
  if (range === 'today') return todayStartTs();
  if (range === '7d') return Date.now() - 7 * 86400000;
  if (range === '30d') return Date.now() - 30 * 86400000;
  return null;
}

interface ImportantBoardProps {
  articles: IArticle[];
  enabledSources: number;
  totalSources: number;
  loaded: boolean;
  loadError: string | null;
  onReload: () => void;
}

export function ImportantBoard({
  articles,
  enabledSources,
  totalSources,
  loaded,
  loadError,
  onReload,
}: ImportantBoardProps) {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [rangeFilter, setRangeFilter] = useState<RangeKey>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const timer = setTimeout(() => setSearchValue(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchValue, rangeFilter, categoryFilter, scoreFilter, sourceFilter]);

  const filterActive =
    searchValue !== '' ||
    rangeFilter !== 'all' ||
    categoryFilter !== 'all' ||
    scoreFilter !== 'all' ||
    sourceFilter !== 'all';

  const clearFilters = () => {
    setSearchInput('');
    setRangeFilter('all');
    setCategoryFilter('all');
    setScoreFilter('all');
    setSourceFilter('all');
  };

  const baseArticles = useMemo(
    () =>
      articles.filter((a) => {
        if (categoryFilter !== 'all' && a.category !== categoryFilter) {
          if (!(categoryFilter === '其他' && !a.category)) return false;
        }
        if (scoreFilter !== 'all' && a.score < Number(scoreFilter)) return false;
        if (sourceFilter !== 'all' && a.sourceId !== sourceFilter) return false;
        return true;
      }),
    [articles, categoryFilter, scoreFilter, sourceFilter],
  );

  const sorted = useMemo(() => {
    const start = rangeStartTs(rangeFilter);
    const keyword = searchValue.toLowerCase();
    const matched = baseArticles.filter((a) => {
      if (start !== null && a.crawledAt < start) return false;
      if (keyword) {
        const haystack = [a.title, a.summary, a.sourceName, a.category, ...a.moatTags]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
    return matched.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      return y.publishedAt - x.publishedAt;
    });
  }, [baseArticles, searchValue, rangeFilter]);

  const visible = sorted.slice(0, visibleCount);

  const openDetail = (id: string) => navigate(`/articles/${id}`);

  return (
    <section className="space-y-4">
      <h2 className="text-base font-bold tracking-tight">重要情报看板</h2>

      {/* 搜索与筛选 */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索标题、摘要、关键词或机构……"
                className="pl-8 pr-8"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchInput('')}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {filterActive && (
              <Button variant="outline" size="sm" className="h-9" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as RangeKey)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={scoreFilter} onValueChange={setScoreFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCORE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === 'all' ? '全部评分' : `${s} 星及以上`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主体</SelectItem>
                {SOURCE_SEED.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 统计指标 */}
      <ImportantBoardStats
        rangeLabel={RANGE_LABEL[rangeFilter]}
        newCount={sorted.length}
        keyCount={sorted.filter((a) => a.score === 5).length}
        highTotal={baseArticles.filter((a) => a.score === 5).length}
        enabledSources={enabledSources}
        totalSources={totalSources}
      />

      {/* 加载中骨架屏 */}
      {!loaded && !loadError && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 py-4">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 加载失败 */}
      {loadError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <p className="text-sm text-muted-foreground">情报加载失败：{loadError.slice(0, 120)}</p>
            <Button variant="outline" size="sm" onClick={onReload}>
              <RotateCw className="size-4" />
              重新加载
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 空状态 */}
      {loaded && !loadError && sorted.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <SearchX className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无符合条件的情报</p>
            {filterActive && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 帖子卡片列表 */}
      {loaded && !loadError && sorted.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            显示 {visible.length} / 共 {sorted.length} 条
          </p>
          {visible.map((a) => (
            <ImportantPostCard key={a.id} article={a} onOpen={openDetail} />
          ))}
          {visibleCount < sorted.length && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                加载更多（剩余 {sorted.length - visibleCount} 条）
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

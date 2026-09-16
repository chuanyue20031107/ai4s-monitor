/**
 * AI4S 情报雷达 — GitHub JSON 数据库版。
 * GitHub Actions 定时更新 public/data，GitHub Pages 只读加载。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  analyzeUrl as apiAnalyzeUrl,
  crawlSource as apiCrawlSource,
  fetchArticles,
  fetchDigest,
  fetchRuns,
  fetchSettings,
  fetchSources,
  pushDigest as apiPushDigest,
  reanalyzeArticle as apiReanalyze,
  saveDigest as apiSaveDigest,
  testSource as apiTestSource,
  toggleSource as apiToggleSource,
  updateSettings as apiUpdateSettings,
} from '@/api/ai4s';
import type { IAi4sSourceCheckItem } from '@shared/api.interface';
import { generateDailyDigestText } from '@/services/ai4sPlugins';
import {
  CATEGORIES,
  CRAWL_STATUS_LABELS,
  DEFAULT_SETTINGS,
  WORKFLOW_STEPS,
  type Category,
  type CrawlStatus,
  type ContentType,
  type IArticle,
  type IRunRecord,
  type ISettings,
  type MoatTag,
  type WorkflowStepStatus,
} from '@/data/ai4s';

const logger = console;

export interface ISourceRuntime {
  enabled: boolean;
  crawlStatus: CrawlStatus;
  lastCrawlAt: number | null;
  lastError: string;
  /** 可配置抓取策略（auto/rss/sitemap/entry/crawler/disabled） */
  crawlStrategy: string;
  /** 自动发现的 RSS/Atom/Sitemap 地址 */
  discoveredFeedUrl: string | null;
  /** 最近一次成功（含无新内容）抓取时间 */
  lastSuccessAt: number | null;
  /** 最近一次健康检查时间 */
  lastCheckAt: number | null;
  /** 抓取诊断信息（状态分类 + 建议修复动作） */
  lastDiagnostic: string;
}

export interface IDailyDigest {
  content: string;
  generatedAt: number;
  articleCount: number;
}

interface IDbArticle {
  id: string;
  title: string;
  sourceKey: string | null;
  sourceName: string | null;
  sourceType: string | null;
  category: string | null;
  publishedAt: string | null;
  crawledAt: string;
  summary: string | null;
  score: number;
  importanceReason: string | null;
  contentType: string | null;
  moatTags: string[] | null;
  url: string;
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'failed' | 'discarded';
  failureReason: string | null;
}

interface IDbRun {
  id: string;
  taskType: string;
  status: 'running' | 'success' | 'failed';
  processed: number;
  succeeded: number;
  failed: number;
  detail: string | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface IDbSource {
  id: string;
  sourceKey: string;
  name: string;
  enabled: boolean;
  crawlStatus: CrawlStatus;
  lastCrawlAt: string | null;
  lastError: string | null;
  crawlStrategy: string | null;
  discoveredFeedUrl: string | null;
  lastSuccessAt: string | null;
  lastDiagnostic: string | null;
  lastCheckAt: string | null;
}

interface IDbSettings {
  dailyCrawlEnabled: boolean;
  dailyPushEnabled: boolean;
  pushTime: string;
  feishuReceivers: string[];
  groupWebhookUrl: string | null;
  weeklyReportEnabled: boolean | null;
  weeklyReportDay: string | null;
  concurrency: number;
  retryCount: number;
  timeoutSeconds: number | null;
  minScore: number;
  focusCategories: string[];
  retentionDays: number;
  crawlWindowStart: string;
  crawlWindowEnd: string;
  lastRunAt: string | null;
}

function toMs(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

function deriveSteps(article: IDbArticle): { step: string; status: WorkflowStepStatus }[] {
  const steps = WORKFLOW_STEPS as readonly string[];
  const donePrefix = ['来源抓取', '内容解析', '去重', '关联主体'];
  return steps.map((step) => {
    if (article.analysisStatus === 'done') {
      return { step, status: 'done' as WorkflowStepStatus };
    }
    if (article.analysisStatus === 'failed') {
      return {
        step,
        status: (step === 'AI 分析' ? 'failed' : donePrefix.includes(step) ? 'done' : 'pending') as WorkflowStepStatus,
      };
    }
    if (article.analysisStatus === 'analyzing') {
      return {
        step,
        status: (step === 'AI 分析' ? 'running' : donePrefix.includes(step) ? 'done' : 'pending') as WorkflowStepStatus,
      };
    }
    return { step, status: 'pending' as WorkflowStepStatus };
  });
}

function normalizeArticle(row: IDbArticle): IArticle {
  return {
    id: row.id,
    title: row.title,
    sourceId: row.sourceKey ?? 'manual',
    sourceName: row.sourceName ?? '手动提交',
    sourceType: row.sourceType ?? '',
    category: (CATEGORIES as readonly string[]).includes(row.category ?? '')
      ? ((row.category ?? '') as IArticle['category'])
      : '',
    publishedAt: toMs(row.publishedAt),
    crawledAt: toMs(row.crawledAt),
    summary: row.summary ?? '',
    score: row.score,
    importanceReason: row.importanceReason ?? '',
    contentType: ((row.contentType ?? '') as ContentType) || '',
    moatTags: (row.moatTags ?? []).filter((t): t is MoatTag => true),
    url: row.url,
    analysisStatus: row.analysisStatus,
    analysisSteps: deriveSteps(row),
    failureReason: row.failureReason ?? undefined,
  };
}

function normalizeRun(row: IDbRun): IRunRecord {
  return {
    id: row.id,
    taskType: row.taskType as IRunRecord['taskType'],
    startedAt: toMs(row.startedAt),
    endedAt: toMs(row.finishedAt ?? row.startedAt),
    processed: row.processed,
    succeeded: row.succeeded,
    failed: row.failed,
    status: row.status,
    failureReason: row.failureReason ?? undefined,
    detail: row.detail ?? '',
  };
}

function normalizeSettings(row: IDbSettings): ISettings {
  return {
    crawlWindowStart: row.crawlWindowStart,
    crawlWindowEnd: row.crawlWindowEnd,
    focusCategories: row.focusCategories.filter((c): c is Category =>
      (CATEGORIES as readonly string[]).includes(c),
    ),
    minScore: row.minScore,
    dailyCrawlEnabled: row.dailyCrawlEnabled,
    dailyPushEnabled: row.dailyPushEnabled,
    pushTime: row.pushTime,
    feishuReceivers: row.feishuReceivers,
    groupWebhookUrl: row.groupWebhookUrl ?? '',
    weeklyReportEnabled: row.weeklyReportEnabled ?? true,
    weeklyReportDay: row.weeklyReportDay ?? 'fri',
    retentionDays: row.retentionDays,
    concurrency: row.concurrency,
    retryCount: row.retryCount,
    timeoutSeconds: row.timeoutSeconds ?? DEFAULT_SETTINGS.timeoutSeconds,
  };
}

function normalizeRuntime(row: IDbSource): ISourceRuntime {
  return {
    enabled: row.enabled,
    crawlStatus: row.crawlStatus,
    lastCrawlAt: row.lastCrawlAt ? toMs(row.lastCrawlAt) : null,
    lastError: row.lastError ?? '',
    crawlStrategy: row.crawlStrategy ?? 'auto',
    discoveredFeedUrl: row.discoveredFeedUrl ?? null,
    lastSuccessAt: row.lastSuccessAt ? toMs(row.lastSuccessAt) : null,
    lastCheckAt: row.lastCheckAt ? toMs(row.lastCheckAt) : null,
    lastDiagnostic: row.lastDiagnostic ?? '',
  };
}

export interface IAi4sContext {
  articles: IArticle[];
  runs: IRunRecord[];
  settings: ISettings;
  sourceRuntime: Record<string, ISourceRuntime>;
  digest: { content: string; generatedAt: number; articleCount: number } | null;
  weeklyDigest: { content: string; generatedAt: number; articleCount: number } | null;
  lastPushAt: number | null;
  lastRunAt: number | null;
  busy: Record<string, boolean>;
  loaded: boolean;
  loadError: string | null;
  refreshAll: () => Promise<void>;
  refreshAfterWrite: () => Promise<void>;
  testSource: (sourceId: string) => Promise<IAi4sSourceCheckItem | null>;
  toggleSource: (id: string) => Promise<void>;
  saveSettings: (settings: ISettings) => Promise<void>;
  crawlSource: (sourceId: string) => Promise<boolean>;
  analyzeUrl: (url: string, silent?: boolean) => Promise<boolean>;
  reanalyzeArticle: (articleId: string, silent?: boolean) => Promise<boolean>;
  generateDigest: (onChunk?: (full: string) => void) => Promise<string | null>;
  generateWeeklyDigest: (onChunk?: (full: string) => void) => Promise<string | null>;
  pushDigest: (type?: 'daily' | 'weekly') => Promise<boolean>;
}

const Ai4sContext = createContext<IAi4sContext | null>(null);

export function Ai4sProvider({ children }: { children: ReactNode }) {
  const [articles, setArticles] = useState<IArticle[]>([]);
  const [runs, setRuns] = useState<IRunRecord[]>([]);
  const [settings, setSettings] = useState<ISettings>(DEFAULT_SETTINGS);
  const [sourceRuntime, setSourceRuntime] = useState<Record<string, ISourceRuntime>>({});
  const [digest, setDigest] = useState<{ content: string; generatedAt: number; articleCount: number } | null>(null);
  const [weeklyDigest, setWeeklyDigest] = useState<{ content: string; generatedAt: number; articleCount: number } | null>(null);
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sourceIdMapRef = useRef<Record<string, string>>({});

  const articlesRef = useRef(articles);
  articlesRef.current = articles;

  const setBusyKey = useCallback((key: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [key]: value }));
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [articlesRes, sourcesRes, settingsRes, runsRes, digestRes, weeklyDigestRes] = await Promise.all([
        fetchArticles(),
        fetchSources(),
        fetchSettings(),
        fetchRuns(),
        fetchDigest(),
        fetchDigest('weekly'),
      ]);
      const runtime: Record<string, ISourceRuntime> = {};
      const idMap: Record<string, string> = {};
      for (const s of sourcesRes.items) {
        runtime[s.sourceKey] = normalizeRuntime(s as IDbSource);
        idMap[s.sourceKey] = s.id;
      }
      sourceIdMapRef.current = idMap;
      setArticles(articlesRes.items.map((a) => normalizeArticle(a as IDbArticle)));
      setSourceRuntime(runtime);
      setSettings(normalizeSettings(settingsRes.settings as IDbSettings));
      setRuns(runsRes.items.map((r) => normalizeRun(r as IDbRun)));
      const d = digestRes.digest;
      setDigest(
        d ? { content: d.content, generatedAt: toMs(d.generatedAt), articleCount: d.articleCount } : null,
      );
      const wd = weeklyDigestRes.digest;
      setWeeklyDigest(
        wd ? { content: wd.content, generatedAt: toMs(wd.generatedAt), articleCount: wd.articleCount } : null,
      );
      const pushRun = runsRes.items.find((r) => r.taskType === '飞书卡片推送' && r.status === 'success');
      setLastPushAt(pushRun ? toMs(pushRun.startedAt) : null);
      const s = settingsRes.settings;
      setLastRunAt(s.lastRunAt ? toMs(s.lastRunAt) : null);
      setLoadError(null);
    } catch (error) {
      logger.error('加载数据失败:', String(error));
      setLoadError(String(error).slice(0, 200));
      toast.error('加载数据失败，请刷新重试');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const refreshAfterWrite = useCallback(async () => {
    try {
      const [articlesRes, sourcesRes, runsRes] = await Promise.all([
        fetchArticles(),
        fetchSources(),
        fetchRuns(),
      ]);
      const runtime: Record<string, ISourceRuntime> = {};
      const idMap: Record<string, string> = {};
      for (const s of sourcesRes.items) {
        runtime[s.sourceKey] = normalizeRuntime(s as IDbSource);
        idMap[s.sourceKey] = s.id;
      }
      sourceIdMapRef.current = idMap;
      setArticles(articlesRes.items.map((a) => normalizeArticle(a as IDbArticle)));
      setSourceRuntime(runtime);
      setRuns(runsRes.items.map((r) => normalizeRun(r as IDbRun)));
      const pushRun = runsRes.items.find((r) => r.taskType === '飞书卡片推送' && r.status === 'success');
      setLastPushAt(pushRun ? toMs(pushRun.startedAt) : null);
    } catch (error) {
      logger.warn('刷新数据失败:', String(error));
    }
  }, []);

  const testSource = useCallback(
    async (sourceId: string): Promise<IAi4sSourceCheckItem | null> => {
      const dbId = sourceIdMapRef.current[sourceId];
      if (!dbId) {
        toast.error('来源不存在，请刷新页面');
        return null;
      }
      setBusyKey(`test:${sourceId}`, true);
      try {
        const res = await apiTestSource(dbId);
        const result: IAi4sSourceCheckItem = res.result;
        const label = CRAWL_STATUS_LABELS[result.status] ?? result.status;
        const message = `「${result.name}」${label}：${result.reason}`;
        if (result.status === 'ok' || result.status === 'no_content') {
          toast.success(message);
        } else if (
          result.status === 'invalid_url' ||
          result.status === 'network_error' ||
          result.status === 'failed'
        ) {
          toast.error(message);
        } else {
          toast.warning(message);
        }
        await refreshAfterWrite();
        return result;
      } catch (error) {
        logger.error('来源测试失败:', String(error));
        toast.error(`测试失败：${String(error).slice(0, 80)}`);
        return null;
      } finally {
        setBusyKey(`test:${sourceId}`, false);
      }
    },
    [refreshAfterWrite, setBusyKey],
  );

  const crawlSource = useCallback(
    async (sourceId: string): Promise<boolean> => {
      const dbId = sourceIdMapRef.current[sourceId];
      if (!dbId) {
        toast.error('来源不存在，请刷新页面');
        return false;
      }
      const runtime = sourceRuntime[sourceId];
      if (runtime && !runtime.enabled) {
        toast.info('该来源已停用，请先在来源管理中启用');
        return false;
      }
      setBusyKey(`source:${sourceId}`, true);
      try {
        const result = await apiCrawlSource(dbId);
        toast.success(result.message);
        await refreshAfterWrite();
        return true;
      } catch (error) {
        logger.error('抓取失败:', String(error));
        toast.error(`抓取失败：${String(error).slice(0, 80)}`);
        await refreshAfterWrite();
        return false;
      } finally {
        setBusyKey(`source:${sourceId}`, false);
      }
    },
    [refreshAfterWrite, setBusyKey, sourceRuntime],
  );

  const analyzeUrl = useCallback(
    async (url: string, silent = false): Promise<boolean> => {
      const trimmed = url.trim();
      if (!/^https?:\/\//.test(trimmed)) {
        if (!silent) toast.error('请输入合法的 http(s) 链接');
        return false;
      }
      setBusyKey('analyze:url', true);
      try {
        const result = await apiAnalyzeUrl({ url: trimmed });
        if (!silent) toast.success(result.message);
        await refreshAfterWrite();
        return true;
      } catch (error) {
        logger.error('URL 分析失败:', String(error));
        if (!silent) toast.error(`分析失败：${String(error).slice(0, 80)}`);
        return false;
      } finally {
        setBusyKey('analyze:url', false);
      }
    },
    [refreshAfterWrite, setBusyKey],
  );

  const reanalyzeArticle = useCallback(
    async (articleId: string, silent = false): Promise<boolean> => {
      setBusyKey(`article:${articleId}`, true);
      try {
        const result = await apiReanalyze(articleId);
        if (!silent) {
          toast.success(result.message);
          await refreshAfterWrite();
        }
        return true;
      } catch (error) {
        logger.error('重新分析失败:', String(error));
        if (!silent) {
          toast.error(`重新分析失败：${String(error).slice(0, 80)}`);
        }
        return false;
      } finally {
        setBusyKey(`article:${articleId}`, false);
      }
    },
    [refreshAfterWrite, setBusyKey],
  );

  const generateDigest = useCallback(
    async (onChunk?: (full: string) => void): Promise<string | null> => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayArticles = articlesRef.current.filter((a) => a.crawledAt >= startOfDay.getTime());
      if (todayArticles.length === 0) {
        toast.warning('今日暂无已抓取情报（0 篇），请先在「监控来源」中执行抓取或等待每日定时任务');
        return null;
      }
      const sortedToday = [...todayArticles].sort((a, b) => b.score - a.score);
      const highArticles = sortedToday.filter((a) => a.score === 5).slice(0, 20);
      const lowArticles = sortedToday.filter((a) => a.score < 5).slice(0, 60);
      setBusyKey('digest', true);
      try {
        const prompt = [
          '你是 AI4S（AI for Science）领域首席情报分析师。请基于以下今日情报素材，整理生成「每日AI4S情报」，输出结构：',
          '依次输出两个板块：【重点情报】（只从下方「高分情报素材」中选取，优先评分最高的，评分低于 5 分的不得进入该板块）、【趋势观察】（2-3 条基于当日全部情报的中文研判，每条一行，条目之间空一行，不要自行添加编号）。日报不输出【其他动态】板块；评分 <5 的情报一律直接丢弃，不得作为条目出现在日报任何位置。输出必须以【趋势观察】板块收尾；若高分情报素材为空，则【重点情报】板块整个不输出，仅输出【趋势观察】。',
          '【重点情报】内部按六个分类依次组织：模型、数据、AI4S 应用、自动化实验室、产业与商业、其他。每个分类先单独一行输出「分类：模型」这样的分类行，再输出该分类下的情报；某分类没有情报时整个分类不输出，既不保留分类行也不写「暂无相关情报」。必须严格沿用素材中已标注的分类，不得自行重新归类；跨领域研究总览按素材给出的分类归位，严禁将已分到模型/数据/AI4S应用/自动化实验室/产业与商业的文章因内容多元而挪到「其他」。',
          '每条情报严格按以下四行输出，「来源」「评分」「摘要」「原文链接」各占一行：',
          '来源：来源名称',
          '评分：X/5',
          '摘要：一句话摘要（两句话以内，不添加未经原文证实的判断）',
          '原文链接：https://...',
          '排版与整理要求：1. 必须纯文本输出，不使用 Markdown；不使用井号、星号、表格、代码块、加粗、斜体或 Markdown 项目符号。2. 所有文字使用统一的表达风格和字号，不要用特殊字符制造不同字号或视觉效果。3. 各个分类之间空两行；每条情报之间空一行。4. 不要把多条情报合并在同一段中。5. 板块内按评分从高到低排列；评分相同时，优先排列影响范围更广、信息密度更高的情报。6. 删除重复情报，保留信息最完整、原文链接最可靠的一条；同一主体、同一评分的多条情报必须合并成一条情报，合并后的摘要控制在三句话以内。7. 最终只输出整理后的正文，不要输出整理过程、分类理由或额外说明。',
          '',
          '今日高分情报素材（评分 =5，【重点情报】条目仅可从这里选择）：',
          ...highArticles.map(
            (a, i) =>
              `${i + 1}. [${a.score}分][${a.category || '未分类'}] ${a.title}（来源主体：${a.sourceName}）摘要：${a.summary || '暂无'} 原文链接：${a.url}`,
          ),
          '',
          '今日低分情报标题参考（仅供【趋势观察】归纳参考，不得输出为条目）：',
          ...lowArticles.map((a, i) => `${i + 1}. [${a.score}分] ${a.title}`),
        ].join('\n');
        const full = await generateDailyDigestText(prompt, onChunk);
        const saved = await apiSaveDigest({ content: full, articleCount: todayArticles.length, digestType: 'daily' });
        if (!saved.digest) throw new Error('摘要保存结果为空');
        setDigest({
          content: saved.digest.content,
          generatedAt: toMs(saved.digest.generatedAt),
          articleCount: saved.digest.articleCount,
        });
        toast.success('每日情报摘要已生成并保存');
        return full;
      } catch (error) {
        logger.error('每日摘要生成失败:', String(error));
        const reason = String(error);
        toast.error(
          reason.includes('额度')
            ? 'AI 插件个人额度已用尽，请续费或等待额度重置后重试'
            : `每日摘要生成失败：${reason.slice(0, 80)}`,
        );
        return null;
      } finally {
        setBusyKey('digest', false);
      }
    },
    [setBusyKey],
  );

  const generateWeeklyDigest = useCallback(
    async (onChunk?: (full: string) => void): Promise<string | null> => {
      const start = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weeklyArticles = articlesRef.current.filter((a) => a.crawledAt >= start);
      if (weeklyArticles.length === 0) {
        toast.warning('近 7 天暂无已抓取情报，请先在「监控来源」中执行抓取或等待每日定时任务');
        return null;
      }
      setBusyKey('weeklyDigest', true);
      try {
        const prompt = [
          '你是 AI4S（AI for Science）领域首席情报分析师。请基于以下近 7 天情报素材，整理生成「每周AI4S情报」，输出结构：',
          '依次输出两个板块：【重点情报】（只从下方「高分情报素材」中选取，最多 20 条，优先评分最高的，评分低于 5 分的不得进入该板块）、【趋势观察】（3-5 条基于本周全部情报跨来源归纳的中文研判，每条一行，条目之间空一行，不要自行添加编号）。周报不输出【其他动态】板块；评分 <5 的情报一律直接丢弃，不得出现在周报任何位置。输出必须以【趋势观察】板块收尾；若高分情报素材为空，则【重点情报】板块整个不输出，仅输出【趋势观察】。',
          '【重点情报】内部按六个分类依次组织：模型、数据、AI4S 应用、自动化实验室、产业与商业、其他。每个分类先单独一行输出「分类：模型」这样的分类行，再输出该分类下的情报；某分类没有情报时整个分类不输出，既不保留分类行也不写「暂无相关情报」。必须严格沿用素材中已标注的分类，不得自行重新归类；跨领域研究总览按素材给出的分类归位，严禁将已分到模型/数据/AI4S应用/自动化实验室/产业与商业的文章因内容多元而挪到「其他」。',
          '每条情报严格按以下四行输出，「来源」「评分」「摘要」「原文链接」各占一行：',
          '来源：来源名称',
          '评分：X/5',
          '摘要：一句话摘要（两句话以内，不添加未经原文证实的判断）',
          '原文链接：https://...',
          '排版与整理要求：1. 必须纯文本输出，不使用 Markdown；不使用井号、星号、表格、代码块、加粗、斜体或 Markdown 项目符号。2. 所有文字使用统一的表达风格和字号，不要用特殊字符制造不同字号或视觉效果。3. 各个分类之间空两行；每条情报之间空一行。4. 不要把多条情报合并在同一段中。5. 板块内按评分从高到低排列；评分相同时，优先排列影响范围更广、信息密度更高的情报。6. 删除重复情报，保留信息最完整、原文链接最可靠的一条；同一主体、同一评分的多条情报必须合并成一条情报，合并后的摘要控制在三句话以内。7. 最终只输出整理后的正文，不要输出整理过程、分类理由或额外说明。',
          '',
          '本周高分情报素材（评分 =5，【重点情报】条目仅可从这里选择）：',
          ...weeklyArticles
            .filter((a) => a.score === 5)
            .slice(0, 20)
            .map(
              (a, i) =>
                `${i + 1}. [${a.score}分][${a.category || '未分类'}] ${a.title}（来源主体：${a.sourceName}）摘要：${a.summary || '暂无'} 原文链接：${a.url}`,
            ),
          '',
          '本周低分情报标题参考（仅供【趋势观察】归纳参考，不得输出为条目）：',
          ...weeklyArticles
            .filter((a) => a.score < 5)
            .slice(0, 60)
            .map((a, i) => `${i + 1}. [${a.score}分] ${a.title}`),
        ].join('\n');
        const full = await generateDailyDigestText(prompt, onChunk);
        const saved = await apiSaveDigest({ content: full, articleCount: weeklyArticles.length, digestType: 'weekly' });
        if (!saved.digest) throw new Error('周报保存结果为空');
        setWeeklyDigest({
          content: saved.digest.content,
          generatedAt: toMs(saved.digest.generatedAt),
          articleCount: saved.digest.articleCount,
        });
        toast.success('每周情报周报已生成并保存');
        return full;
      } catch (error) {
        logger.error('每周周报生成失败:', String(error));
        const reason = String(error);
        toast.error(
          reason.includes('额度')
            ? 'AI 插件个人额度已用尽，请续费或等待额度重置后重试'
            : `每周周报生成失败：${reason.slice(0, 80)}`,
        );
        return null;
      } finally {
        setBusyKey('weeklyDigest', false);
      }
    },
    [setBusyKey],
  );

  const pushDigest = useCallback(async (type: 'daily' | 'weekly' = 'daily'): Promise<boolean> => {
    setBusyKey(`push:${type}`, true);
    try {
      const result = await apiPushDigest(type);
      if (result.success) {
        setLastPushAt(Date.now());
        toast.success(type === 'weekly' ? '每周周报推送成功' : '飞书卡片推送成功');
        await refreshAfterWrite();
        return true;
      }
      toast.error(result.message);
      await refreshAfterWrite();
      return false;
    } catch (error) {
      logger.error('飞书推送失败:', String(error));
      toast.error(`飞书推送失败：${String(error).slice(0, 80)}`);
      return false;
    } finally {
      setBusyKey(`push:${type}`, false);
    }
  }, [refreshAfterWrite, setBusyKey]);

  const toggleSource = useCallback(
    async (id: string): Promise<void> => {
      const dbId = sourceIdMapRef.current[id];
      if (!dbId) {
        toast.error('来源不存在，请刷新页面');
        return;
      }
      try {
        const res = await apiToggleSource(dbId);
        const runtime: Record<string, ISourceRuntime> = {};
        for (const s of res.items) {
          runtime[s.sourceKey] = normalizeRuntime(s as IDbSource);
        }
        setSourceRuntime(runtime);
      } catch (error) {
        logger.error('切换来源状态失败:', String(error));
        toast.error(`切换失败：${String(error).slice(0, 80)}`);
      }
    },
    [],
  );

  const saveSettings = useCallback(
    async (next: ISettings): Promise<void> => {
      try {
        const res = await apiUpdateSettings({
          crawlWindowStart: next.crawlWindowStart,
          crawlWindowEnd: next.crawlWindowEnd,
          focusCategories: next.focusCategories,
          minScore: next.minScore,
          dailyCrawlEnabled: next.dailyCrawlEnabled,
          dailyPushEnabled: next.dailyPushEnabled,
          pushTime: next.pushTime,
          feishuReceivers: next.feishuReceivers,
          groupWebhookUrl: next.groupWebhookUrl,
          weeklyReportEnabled: next.weeklyReportEnabled,
          weeklyReportDay: next.weeklyReportDay,
          retentionDays: next.retentionDays,
          concurrency: next.concurrency,
          retryCount: next.retryCount,
          timeoutSeconds: next.timeoutSeconds,
        });
        setSettings(normalizeSettings(res.settings as IDbSettings));
        setLastRunAt(res.settings.lastRunAt ? toMs(res.settings.lastRunAt) : null);
        toast.success('设置已保存，服务端定时任务将按新配置执行');
      } catch (error) {
        logger.error('保存设置失败:', String(error));
        toast.error(`保存失败：${String(error).slice(0, 80)}`);
        throw error;
      }
    },
    [],
  );

  const value = useMemo<IAi4sContext>(
    () => ({
      articles,
      runs,
      settings,
      sourceRuntime,
      digest,
      weeklyDigest,
      lastPushAt,
      lastRunAt,
      busy,
      loaded,
      loadError,
      refreshAll,
      refreshAfterWrite,
      testSource,
      toggleSource,
      saveSettings,
      crawlSource,
      analyzeUrl,
      reanalyzeArticle,
      generateDigest,
      generateWeeklyDigest,
      pushDigest,
    }),
    [
      articles, runs, settings, sourceRuntime, digest, weeklyDigest, lastPushAt, lastRunAt, busy, loaded,
      loadError,
      refreshAll, refreshAfterWrite, testSource, toggleSource, saveSettings, crawlSource,
      analyzeUrl, reanalyzeArticle, generateDigest, generateWeeklyDigest, pushDigest,
    ],
  );

  return <Ai4sContext.Provider value={value}>{children}</Ai4sContext.Provider>;
}

export function useAi4s(): IAi4sContext {
  const ctx = useContext(Ai4sContext);
  if (!ctx) {
    throw new Error('useAi4s must be used within Ai4sProvider');
  }
  return ctx;
}

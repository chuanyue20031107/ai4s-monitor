/* AI4S 情报雷达 — 前后端共享类型定义（时间字段一律 ISO string） */

export type Ai4sPriority = '高' | '中' | '低';

/** 来源抓取状态（七类失败原因 + 成功/无新内容/初始态） */
export type Ai4sCrawlStatus =
  | 'idle'
  | 'ok'
  | 'no_content'
  | 'invalid_url'
  | 'robots_blocked'
  | 'timeout'
  | 'network_error'
  | 'parse_failed'
  | 'needs_config'
  | 'failed';

/** 来源抓取策略：auto 自动解析；disabled 表示不可抓取/需人工配置 */
export type Ai4sCrawlStrategy = 'auto' | 'rss' | 'sitemap' | 'entry' | 'crawler' | 'disabled';

/** 健康检查实际解析出的执行通道 */
export type Ai4sResolvedStrategy = 'rss' | 'sitemap' | 'entry' | 'crawler' | 'none';

export type Ai4sAnalysisStatus = 'pending' | 'analyzing' | 'done' | 'failed' | 'discarded';
export type Ai4sRunStatus = 'running' | 'success' | 'failed';

// ---------- 来源主体（含运行时状态） ----------
export interface IAi4sSource {
  id: string;
  sourceKey: string;
  name: string;
  groupName: string;
  type: string;
  region: string;
  directions: string;
  products: string;
  representative: string;
  website: string;
  wechat: string;
  linkedin: string;
  github: string;
  feedUrl: string;
  priority: Ai4sPriority;
  notes: string;
  enabled: boolean;
  /** 可配置抓取策略（auto=按 RSS>Sitemap>会议列表>crawler 优先级解析） */
  crawlStrategy: Ai4sCrawlStrategy;
  /** 自动发现并保存的 RSS/Atom/Sitemap 地址 */
  discoveredFeedUrl: string | null;
  crawlStatus: Ai4sCrawlStatus;
  lastCrawlAt: string | null;
  /** 最近一次成功（含"无新内容"）抓取时间 */
  lastSuccessAt: string | null;
  /** 抓取诊断信息（状态分类 + 建议修复动作） */
  lastDiagnostic: string | null;
  /** 最近一次健康检查时间 */
  lastCheckAt: string | null;
  lastError: string;
  /** 可选以兼容历史快照；下次维护/采集补齐默认值。 */
  failureType?: string;
  repairSuggestion?: string;
  autoRepairAvailable?: boolean;
}

export interface ISourceDiagnostic {
  sourceKey: string;
  name: string;
  oldStatus: Ai4sCrawlStatus;
  entryUrl: string;
  checkedAt: string;
  diagnosis: string;
  failureType: string;
  suggestion: string;
  autoRepairAvailable: boolean;
  rss: string | null;
  sitemap: string | null;
  repairStatus: 'not_applied' | 'applied' | 'validation_failed';
  repairedAt?: string;
  checks: { dns: string; https: string; robots: string; httpStatus: number | null; robotsHttpStatus: number | null; rss: string; sitemap: string };
}

// ---------- 情报文章 ----------
export interface IAi4sArticle {
  id: string;
  title: string;
  sourceKey: string;
  sourceName: string;
  sourceType: string;
  category: string;
  publishedAt: string | null;
  crawledAt: string;
  summary: string;
  score: number;
  importanceReason: string;
  contentType: string;
  moatTags: string[];
  url: string;
  analysisStatus: Ai4sAnalysisStatus;
  failureReason: string;
}

// ---------- 设置（服务端定时任务真实读取） ----------
export interface IAi4sSettings {
  dailyCrawlEnabled: boolean;
  dailyPushEnabled: boolean;
  pushTime: string;
  feishuReceivers: string[];
  /** 飞书群自定义机器人 Webhook 地址 */
  groupWebhookUrl: string;
  /** 每周周报开关 */
  weeklyReportEnabled: boolean;
  /** 周报生成日（mon~sun） */
  weeklyReportDay: string;
  concurrency: number;
  retryCount: number;
  /** 单次 HTTP 请求超时秒数（真实作用于服务端抓取） */
  timeoutSeconds: number;
  minScore: number;
  focusCategories: string[];
  retentionDays: number;
  crawlWindowStart: string;
  crawlWindowEnd: string;
  lastRunAt: string | null;
}

export interface IAi4sUpdateSettingsRequest {
  dailyCrawlEnabled?: boolean;
  dailyPushEnabled?: boolean;
  pushTime?: string;
  feishuReceivers?: string[];
  groupWebhookUrl?: string;
  weeklyReportEnabled?: boolean;
  weeklyReportDay?: string;
  concurrency?: number;
  retryCount?: number;
  timeoutSeconds?: number;
  minScore?: number;
  focusCategories?: string[];
  retentionDays?: number;
  crawlWindowStart?: string;
  crawlWindowEnd?: string;
}

// ---------- 运行记录 ----------
export interface IAi4sRunRecord {
  id: string;
  taskType: string;
  status: Ai4sRunStatus;
  processed: number;
  succeeded: number;
  failed: number;
  detail: string;
  failureReason: string;
  startedAt: string;
  finishedAt: string | null;
}

// ---------- 每日摘要 ----------
export interface IAi4sDigest {
  id: string;
  content: string;
  articleCount: number;
  generatedAt: string;
  digestType: 'daily' | 'weekly';
}

// ---------- 来源健康检查 / 测试 ----------
export interface IAi4sSourceCheckItem {
  sourceKey: string;
  name: string;
  strategy: Ai4sCrawlStrategy;
  resolvedStrategy: Ai4sResolvedStrategy;
  /** 实际请求的地址（协议补全/发现结果；无地址为空字符串） */
  url: string;
  status: Ai4sCrawlStatus;
  reason: string;
  suggestion: string;
  /** 本通道解析出的可入库条目数（0 表示无条目或仅验证可达） */
  articlesFound: number;
  durationMs: number;
}

export interface IAi4sTestSourceResponse {
  result: IAi4sSourceCheckItem;
  source: IAi4sSource;
}

export interface IAi4sHealthCheckStartResponse {
  runId: string;
  total: number;
}

export interface IAi4sCrawlAllStartResponse {
  runId: string;
  total: number;
}

export interface IAi4sHealthCheckTypeCount {
  type: Ai4sCrawlStatus;
  count: number;
}

export interface IAi4sHealthCheckStats {
  runId: string | null;
  status: Ai4sRunStatus | null;
  running: boolean;
  total: number;
  ok: number;
  noContent: number;
  failed: number;
  failureByType: IAi4sHealthCheckTypeCount[];
  lastCheckAt: string | null;
}

export interface IAi4sHealthCheckStatsResponse {
  stats: IAi4sHealthCheckStats;
}

// ---------- 接口响应 ----------
export interface IAi4sArticlesResponse {
  items: IAi4sArticle[];
}

export interface IAi4sSourcesResponse {
  items: IAi4sSource[];
}

export interface IAi4sRunsResponse {
  items: IAi4sRunRecord[];
}

export interface IAi4sSettingsResponse {
  settings: IAi4sSettings;
}

export interface IAi4sDigestResponse {
  digest: IAi4sDigest | null;
}

/** 单来源抓取（或每日任务）结果 */
export interface IAi4sIngestResult {
  success: boolean;
  inserted: number;
  skipped: number;
  analyzed: number;
  failedArticles: number;
  message: string;
}

/** 存量「其他」类重分类结果 */
export interface IAi4sRecategorizeResult {
  success: boolean;
  discarded: number;
  recategorized: number;
  stillOther: number;
  message: string;
}

/** 手动 URL 分析请求 */
export interface IAi4sAnalyzeUrlRequest {
  url: string;
}

/** 保存摘要请求 */
export interface IAi4sSaveDigestRequest {
  content: string;
  articleCount: number;
  digestType?: 'daily' | 'weekly';
}

/** 推送结果 */
export interface IAi4sPushResult {
  success: boolean;
  message: string;
}

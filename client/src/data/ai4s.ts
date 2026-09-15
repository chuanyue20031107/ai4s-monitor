// EXPORTS: Category, ContentType, MoatTag, Priority, TaskType, AnalysisStatus, CrawlStatus, RunStatus, ISource, IArticle, IRunRecord, ISettings, PLUGIN_IDS, CATEGORIES, CATEGORY_PRIORITY_ORDER, CONTENT_TYPES, MOAT_TAGS, SOURCE_GROUPS, TASK_TYPES, WORKFLOW_STEPS, DEFAULT_SETTINGS, CRAWL_STATUS_LABELS, SOURCE_SEED

/**
 * AI4S 情报雷达 — 数据模型与固定字典
 *
 * 来源清单说明：SOURCE_SEED 已由用户上传的《AI4S咨询信息源与主体清单.xlsx》解析生成
 * （见 ai4s-sources.ts，共 184 条主体 / 10 个分组），字段按各 sheet 结构映射：
 * 优先级 S/A/B → 高/中/低；论文或开源来源 → GitHub / RSS 字段；社媒来源 → LinkedIn；
 * 主体类型保留清单原文（自由文本），筛选按 10 个清单分组进行。
 */

// ---------- 插件实例 ID（capabilityClient.load 用） ----------
export const PLUGIN_IDS = {
  crawler: 'ai4s_intelligence_crawler_1',
  analyzer: 'ai4s_intelligence_article_structured_analysis_1',
  pusher: 'ai4s_daily_intelligence_feishu_push_1',
  digest: 'agent_reply_1',
} as const;

// ---------- 固定分类（六类，含优先级） ----------
export const CATEGORIES = ['模型', '数据', 'AI4S 应用', '自动化实验室', '产业与商业', '其他'] as const;
export type Category = (typeof CATEGORIES)[number];

/** 分类优先级（数值越大越优先）：产业与商业 > 自动化实验室 > 模型 > 数据 > AI4S 应用 > 其他 */
export const CATEGORY_PRIORITY_ORDER: Record<Category, number> = {
  产业与商业: 6,
  自动化实验室: 5,
  模型: 4,
  数据: 3,
  'AI4S 应用': 2,
  其他: 1,
};

// ---------- 内容类型（三选一） ----------
export const CONTENT_TYPES = ['company_claim', 'paper_result', 'media_report'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// ---------- 护城河影响标签（可多选） ----------
export const MOAT_TAGS = ['数据', '模型', '实验自动化', '药物设计', '材料发现', '商业合作', '人才'] as const;
export type MoatTag = (typeof MOAT_TAGS)[number];

// ---------- 清单分组（对应 Excel 的 10 个工作表） ----------
export const SOURCE_GROUPS = [
  '海外大厂与研究机构',
  '海外AI4S创业公司',
  '国内模型与科研软件',
  '实验自动化与仪器',
  '自主实验室与平台',
  '下游客户与应用方',
  '科学数据库与平台',
  '政策项目与采购',
  '国内学会与学术活动',
  '国际标准学会与活动',
] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export type Priority = '高' | '中' | '低';

// ---------- 运行任务类型 ----------
export const TASK_TYPES = [
  '来源抓取',
  '内容解析',
  '去重',
  '分类',
  'AI 分析',
  '每日摘要生成',
  '飞书卡片推送',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

// ---------- 文章处理工作流步骤 ----------
export const WORKFLOW_STEPS = ['来源抓取', '内容解析', '去重', '关联主体', '分类', 'AI 分析', '保存完成'] as const;
export type WorkflowStepStatus = 'pending' | 'running' | 'done' | 'failed';

export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'failed' | 'discarded';
export type CrawlStatus =
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

/** 来源抓取状态中文标签（健康检查 / 测试结果展示共用） */
export const CRAWL_STATUS_LABELS: Record<CrawlStatus, string> = {
  idle: '未抓取',
  ok: '正常',
  no_content: '无新内容',
  invalid_url: '地址无效',
  robots_blocked: 'Robots 禁止',
  timeout: '超时',
  network_error: '网络错误',
  parse_failed: '解析失败',
  needs_config: '需人工配置',
  failed: '失败',
};
export type RunStatus = 'running' | 'success' | 'failed';

// ---------- 来源主体（《清单》字段全量） ----------
export interface ISource {
  id: string;
  /** 主体名称 */
  name: string;
  /** 清单分组（来源清单工作表） */
  group: SourceGroup;
  /** 主体类型（清单原文，自由文本） */
  type: string;
  /** 国家/地区 */
  region: string;
  /** AI4S 研究方向 */
  directions: string;
  /** 核心产品/平台 */
  products: string;
  /** 代表人物/负责人 */
  representative: string;
  /** 官方网站 */
  website: string;
  /** 官方公众号（无则空字符串） */
  wechat: string;
  /** LinkedIn */
  linkedin: string;
  /** GitHub */
  github: string;
  /** RSS 或会议链接 */
  feedUrl: string;
  /** 优先级 */
  priority: Priority;
  /** 备注 */
  notes: string;
}

// ---------- 情报文章 ----------
export interface IArticle {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  category: Category | '';
  publishedAt: number;
  crawledAt: number;
  /** 中文摘要 */
  summary: string;
  /** 重要性评分 1-5（0 表示尚未分析） */
  score: number;
  /** 重要性理由 */
  importanceReason: string;
  contentType: ContentType | '';
  /** 护城河影响标签（可多选） */
  moatTags: MoatTag[];
  /** 原文链接 */
  url: string;
  analysisStatus: AnalysisStatus;
  /** 分析过程状态（工作流步骤） */
  analysisSteps: { step: string; status: WorkflowStepStatus }[];
  failureReason?: string;
}

// ---------- 运行记录 ----------
export interface IRunRecord {
  id: string;
  taskType: TaskType;
  startedAt: number;
  endedAt: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: RunStatus;
  failureReason?: string;
  detail: string;
}

// ---------- 设置 ----------
export const WEEKDAY_OPTIONS = [
  { value: 'mon', label: '周一' },
  { value: 'tue', label: '周二' },
  { value: 'wed', label: '周三' },
  { value: 'thu', label: '周四' },
  { value: 'fri', label: '周五' },
  { value: 'sat', label: '周六' },
  { value: 'sun', label: '周日' },
];

export interface ISettings {
  /** 抓取时间窗口 */
  crawlWindowStart: string;
  crawlWindowEnd: string;
  /** 关注分类 */
  focusCategories: Category[];
  /** 最低重要性评分（1-5） */
  minScore: number;
  /** 是否启用每日定时抓取（服务端触发器读取） */
  dailyCrawlEnabled: boolean;
  /** 是否启用每日推送 */
  dailyPushEnabled: boolean;
  /** 推送时间（半小时粒度，服务端触发器读取） */
  pushTime: string;
  /** 飞书接收配置（用户 ID 列表） */
  feishuReceivers: string[];
  /** 飞书群自定义机器人 Webhook 地址 */
  groupWebhookUrl: string;
  /** 每周周报开关 */
  weeklyReportEnabled: boolean;
  /** 周报生成日（mon~sun） */
  weeklyReportDay: string;
  /** 数据保留策略（天数） */
  retentionDays: number;
  /** 抓取并发数（服务端每日任务读取） */
  concurrency: number;
  /** 单来源抓取重试次数（服务端每日任务读取） */
  retryCount: number;
  /** 单请求超时秒数，真实作用于服务端抓取 */
  timeoutSeconds: number;
}

export const DEFAULT_SETTINGS: ISettings = {
  crawlWindowStart: '08:00',
  crawlWindowEnd: '20:00',
  focusCategories: [...CATEGORIES],
  minScore: 3,
  dailyCrawlEnabled: true,
  dailyPushEnabled: true,
  pushTime: '18:00',
  feishuReceivers: [],
  groupWebhookUrl: '',
  weeklyReportEnabled: true,
  weeklyReportDay: 'fri',
  retentionDays: 90,
  concurrency: 4,
  retryCount: 2,
  timeoutSeconds: 30,
};

// ---------- 来源清单（由 Excel《AI4S咨询信息源与主体清单》解析生成，见 ai4s-sources.ts） ----------
export { SOURCE_SEED } from './ai4s-sources';

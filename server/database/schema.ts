/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const ai4sDigest = pgTable("ai4s_digest", {
  id: uuid("id").primaryKey().defaultRandom(),
  content: text("content").notNull(),
  articleCount: integer("article_count").notNull().default(0),
  generatedAt: customTimestamptz("generated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  digestType: varchar("digest_type", { length: 20 }).notNull().default('daily'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const ai4sRun = pgTable("ai4s_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskType: varchar("task_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  processed: integer("processed").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  detail: text("detail"),
  failureReason: text("failure_reason"),
  startedAt: customTimestamptz("started_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: customTimestamptz("finished_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_ai4s_run_started_at").on(table.startedAt),
]);

export const ai4sSettings = pgTable("ai4s_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  dailyCrawlEnabled: boolean("daily_crawl_enabled").notNull().default(true),
  dailyPushEnabled: boolean("daily_push_enabled").notNull().default(true),
  pushTime: varchar("push_time", { length: 5 }).notNull().default('18:00'),
  /**
   * @type { string[] }
   */
  feishuReceivers: jsonb("feishu_receivers"),
  concurrency: integer("concurrency").notNull().default(4),
  retryCount: integer("retry_count").notNull().default(2),
  minScore: integer("min_score").notNull().default(3),
  /**
   * @type { string[] }
   */
  focusCategories: jsonb("focus_categories"),
  retentionDays: integer("retention_days").notNull().default(90),
  crawlWindowStart: varchar("crawl_window_start", { length: 5 }).notNull().default('08:00'),
  crawlWindowEnd: varchar("crawl_window_end", { length: 5 }).notNull().default('20:00'),
  lastRunAt: customTimestamptz("last_run_at", { precision: 6 }),
  timeoutSeconds: integer("timeout_seconds").notNull().default(30),
  /**
   * @type { string[] }
   */
  feishuGroupReceivers: jsonb("feishu_group_receivers"),
  groupWebhookUrl: text("group_webhook_url"),
  weeklyReportEnabled: boolean("weekly_report_enabled").notNull().default(true),
  weeklyReportDay: varchar("weekly_report_day", { length: 10 }).notNull().default('fri'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const ai4sArticle = pgTable("ai4s_article", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  sourceKey: varchar("source_key", { length: 50 }),
  sourceName: varchar("source_name", { length: 255 }),
  sourceType: varchar("source_type", { length: 100 }),
  category: varchar("category", { length: 50 }),
  publishedAt: customTimestamptz("published_at", { precision: 6 }),
  crawledAt: customTimestamptz("crawled_at", { precision: 6 }).notNull(),
  summary: text("summary"),
  score: integer("score").notNull().default(0),
  importanceReason: text("importance_reason"),
  contentType: varchar("content_type", { length: 50 }),
  /**
   * @type { string[] }
   */
  moatTags: jsonb("moat_tags"),
  url: text("url").notNull().unique(),
  analysisStatus: varchar("analysis_status", { length: 20 }).notNull().default('pending'),
  failureReason: text("failure_reason"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("idx_ai4s_article_url").on(table.url),
  index("idx_ai4s_article_crawled_at").on(table.crawledAt),
]);

export const ai4sSource = pgTable("ai4s_source", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: varchar("source_key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  groupName: varchar("group_name", { length: 100 }),
  type: varchar("type", { length: 100 }),
  region: varchar("region", { length: 100 }),
  directions: text("directions"),
  products: text("products"),
  representative: varchar("representative", { length: 255 }),
  website: text("website"),
  wechat: varchar("wechat", { length: 255 }),
  linkedin: text("linkedin"),
  github: text("github"),
  feedUrl: text("feed_url"),
  priority: varchar("priority", { length: 10 }),
  notes: text("notes"),
  enabled: boolean("enabled").notNull().default(true),
  crawlStatus: varchar("crawl_status", { length: 20 }).notNull().default('idle'),
  lastCrawlAt: customTimestamptz("last_crawl_at", { precision: 6 }),
  lastError: text("last_error"),
  crawlStrategy: varchar("crawl_strategy", { length: 20 }).notNull().default('auto'),
  discoveredFeedUrl: text("discovered_feed_url"),
  lastSuccessAt: customTimestamptz("last_success_at", { precision: 6 }),
  lastDiagnostic: text("last_diagnostic"),
  lastCheckAt: customTimestamptz("last_check_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  uniqueIndex("idx_ai4s_source_key").on(table.sourceKey),
]);

// table aliases
export const ai4sArticleTable = ai4sArticle;
export const ai4sDigestTable = ai4sDigest;
export const ai4sRunTable = ai4sRun;
export const ai4sSettingsTable = ai4sSettings;
export const ai4sSourceTable = ai4sSource;

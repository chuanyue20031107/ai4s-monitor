import type { IAi4sSourcesResponse, IAi4sHealthCheckStatsResponse } from '@shared/api.interface';
export const REPOSITORY = 'chuanyue20031107/ai4s-monitor';
export const SOURCE_ACTIONS_URL = `https://github.com/${REPOSITORY}/actions/workflows/source-operations.yml`;
export type SourceAction = 'health_check' | 'crawl' | 'crawl_all' | 'retry_failed' | 'set_enabled';
export interface SourceCommand { version: 1; requestId: string; action: SourceAction; sourceId?: string; enabled?: boolean }
export interface SourceReceipt extends SourceCommand { issueNumber: number; issueUrl: string; runUrl: string; status: 'success' | 'partial' | 'failed'; detail: string; finishedAt: string }
export interface SourceDraft { command: SourceCommand; label: string; url: string; createdAt: string }
const KEY = 'ai4s-source-requests-v1';
export function newSourceDraft(action: SourceAction, label: string, sourceId?: string, enabled?: boolean): SourceDraft {
  const command: SourceCommand = { version: 1, requestId: crypto.randomUUID(), action, ...(sourceId ? {sourceId} : {}), ...(enabled === undefined ? {} : {enabled}) };
  const body = `由 AI4S 监控来源页面生成。请确认操作后提交；只有仓库写入者的请求会执行。\n\n\`\`\`json\n${JSON.stringify(command, null, 2)}\n\`\`\`\n\n不更改每六小时定时任务，不在前端保存 Token。`;
  const query = new URLSearchParams({ title: `[source-op] ${label}`, body });
  return { command, label, url: `https://github.com/${REPOSITORY}/issues/new?${query}`, createdAt: new Date().toISOString() };
}
export function readDrafts(): SourceDraft[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is SourceDraft => Boolean(v && typeof v === 'object' && v.command?.requestId && typeof v.label === 'string' && typeof v.url === 'string' && v.url.startsWith(`https://github.com/${REPOSITORY}/issues/new?`))).slice(0, 20);
  } catch { return []; }
}
export function saveDrafts(value: SourceDraft[]) { try { localStorage.setItem(KEY, JSON.stringify(value.slice(0,20))); } catch { /* Storage disabled: current-tab state still works. */ } }
async function snapshot<T>(name: string, empty?: T): Promise<T> {
  // Read public versioned JSON only, never send authorization or write from the browser.
  const urls = [`https://raw.githubusercontent.com/${REPOSITORY}/main/client/public/data/${name}.json?t=${Date.now()}`, `${import.meta.env.BASE_URL}data/${name}.json?t=${Date.now()}`];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (response.ok) return await response.json() as T;
      if (response.status === 404 && empty !== undefined) continue;
    } catch { /* Fallback to the deployed Pages snapshot. */ }
  }
  if (empty !== undefined) return empty;
  throw new Error('无法读取来源数据，请稍后刷新。');
}
export async function loadSourceSnapshot() {
  const [sources, health, receipts] = await Promise.all([
    snapshot<IAi4sSourcesResponse & {updatedAt?: string}>('sources'),
    snapshot<IAi4sHealthCheckStatsResponse>('health'),
    snapshot<{items: SourceReceipt[]}>('source-commands', {items:[]}),
  ]);
  return {sources, health, receipts};
}

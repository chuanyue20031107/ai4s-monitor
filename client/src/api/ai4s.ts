/**
 * GitHub Pages 数据适配层。
 * 数据由 GitHub Actions 写入 client/public/data/*.json，前端只读加载。
 */
import type {
  IAi4sAnalyzeUrlRequest,
  IAi4sArticlesResponse,
  IAi4sCrawlAllStartResponse,
  IAi4sDigestResponse,
  IAi4sHealthCheckStartResponse,
  IAi4sHealthCheckStatsResponse,
  IAi4sIngestResult,
  IAi4sPushResult,
  IAi4sRunsResponse,
  IAi4sSaveDigestRequest,
  IAi4sSettingsResponse,
  IAi4sSourcesResponse,
  IAi4sTestSourceResponse,
  IAi4sUpdateSettingsRequest,
} from '@shared/api.interface';

const ACTIONS_URL = 'https://github.com/chuanyue20031107/ai4s-monitor/actions/workflows/crawl-and-deploy.yml';

function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}data/${name}.json`;
}

async function loadJson<T>(name: string): Promise<T> {
  if (!import.meta.env.DEV && name === 'articles') {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/chuanyue20031107/ai4s-monitor/main/client/public/data/articles.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.ok) return await response.json() as T;
    } catch { /* Use the last deployed snapshot when GitHub is unavailable. */ }
  }
  const response = await fetch(dataUrl(name), { cache: 'no-store' });
  if (!response.ok) throw new Error(`GitHub 数据文件加载失败：${name} (${response.status})`);
  return response.json() as Promise<T>;
}

function actionsOnly(): never {
  window.open(ACTIONS_URL, '_blank', 'noopener,noreferrer');
  throw new Error('静态站点不直接写库；已打开 GitHub Actions，请点击 Run workflow');
}

export const fetchArticles = () => loadJson<IAi4sArticlesResponse>('articles');
export const fetchSources = () => loadJson<IAi4sSourcesResponse>('sources');
export const fetchSettings = () => loadJson<IAi4sSettingsResponse>('settings');
export const fetchRuns = () => loadJson<IAi4sRunsResponse>('runs');
export const fetchHealthCheckStats = () => loadJson<IAi4sHealthCheckStatsResponse>('health');

export async function fetchDigest(type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sDigestResponse> {
  return loadJson<IAi4sDigestResponse>(type === 'weekly' ? 'weekly-digest' : 'digest');
}

export async function updateSettings(_payload: IAi4sUpdateSettingsRequest): Promise<IAi4sSettingsResponse> {
  return actionsOnly();
}

export async function toggleSource(_id: string): Promise<IAi4sSourcesResponse> {
  return actionsOnly();
}

export async function crawlSource(_id: string): Promise<IAi4sIngestResult> {
  return actionsOnly();
}

export async function startCrawlAll(): Promise<IAi4sCrawlAllStartResponse> {
  return actionsOnly();
}

export async function analyzeUrl(_payload: IAi4sAnalyzeUrlRequest): Promise<IAi4sIngestResult> {
  return actionsOnly();
}

export async function reanalyzeArticle(_id: string): Promise<IAi4sIngestResult> {
  return actionsOnly();
}

export async function pushDigest(_type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sPushResult> {
  return actionsOnly();
}

export async function testSource(_id: string): Promise<IAi4sTestSourceResponse> {
  return actionsOnly();
}

export async function startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
  return actionsOnly();
}

export async function saveDigest(_payload: IAi4sSaveDigestRequest): Promise<IAi4sDigestResponse> {
  return actionsOnly();
}

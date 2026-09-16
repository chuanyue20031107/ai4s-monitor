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

const ACTIONS_URL = 'https://github.com/chuanyue20031107/ai4s-monitor/actions';
const HEALTH_WORKFLOW = 'https://github.com/chuanyue20031107/ai4s-monitor/actions/workflows/source-health-check.yml';

function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}data/${name}.json`;
}

async function loadJson<T>(name: string): Promise<T> {
  const response = await fetch(dataUrl(name), { cache: 'no-store' });
  if (!response.ok) throw new Error(`GitHub 数据文件加载失败：${name}`);
  return response.json() as Promise<T>;
}

function openAction(url = ACTIONS_URL): never {
  window.open(url, '_blank', 'noopener,noreferrer');
  throw new Error('已打开 GitHub Actions，请运行对应任务');
}

export const fetchArticles = () => loadJson<IAi4sArticlesResponse>('articles');
export const fetchSources = () => loadJson<IAi4sSourcesResponse>('sources');
export const fetchSettings = () => loadJson<IAi4sSettingsResponse>('settings');
export const fetchRuns = () => loadJson<IAi4sRunsResponse>('runs');
export const fetchHealthCheckStats = () => loadJson<IAi4sHealthCheckStatsResponse>('health');

export async function fetchDigest(type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sDigestResponse> {
  return loadJson(type === 'weekly' ? 'weekly-digest' : 'digest');
}

export function startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
  return Promise.reject(openAction(HEALTH_WORKFLOW));
}

export function startCrawlAll(): Promise<IAi4sCrawlAllStartResponse> {
  return Promise.reject(openAction(ACTIONS_URL));
}

export function testSource(_id: string): Promise<IAi4sTestSourceResponse> {
  return Promise.reject(openAction(HEALTH_WORKFLOW));
}

export function crawlSource(_id: string): Promise<IAi4sIngestResult> {
  return Promise.reject(openAction(ACTIONS_URL));
}

export function updateSettings(_payload: IAi4sUpdateSettingsRequest): Promise<IAi4sSettingsResponse> { return Promise.reject(openAction()); }
export function toggleSource(_id: string): Promise<IAi4sSourcesResponse> { return Promise.reject(openAction()); }
export function analyzeUrl(_payload: IAi4sAnalyzeUrlRequest): Promise<IAi4sIngestResult> { return Promise.reject(openAction()); }
export function reanalyzeArticle(_id: string): Promise<IAi4sIngestResult> { return Promise.reject(openAction()); }
export function pushDigest(_type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sPushResult> { return Promise.reject(openAction()); }
export function saveDigest(_payload: IAi4sSaveDigestRequest): Promise<IAi4sDigestResponse> { return Promise.reject(openAction()); }

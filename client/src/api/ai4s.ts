/**
 * AI4S 情报雷达 — 后端 API 封装（全栈模式：数据存服务端数据库）
 */
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  IAi4sAnalyzeUrlRequest,
  IAi4sArticlesResponse,
  IAi4sCrawlAllStartResponse,
  IAi4sDigestResponse,
  IAi4sHealthCheckStartResponse,
  IAi4sHealthCheckStatsResponse,
  IAi4sIngestResult,
  IAi4sPushResult,
  IAi4sTestSourceResponse,
  IAi4sRunsResponse,
  IAi4sSaveDigestRequest,
  IAi4sSettingsResponse,
  IAi4sSourcesResponse,
  IAi4sUpdateSettingsRequest,
} from '@shared/api.interface';

export async function fetchArticles(): Promise<IAi4sArticlesResponse> {
  return axiosForBackend.get('/api/ai4s/articles').then((res) => res.data);
}

export async function fetchSources(): Promise<IAi4sSourcesResponse> {
  return axiosForBackend.get('/api/ai4s/sources').then((res) => res.data);
}

export async function fetchSettings(): Promise<IAi4sSettingsResponse> {
  return axiosForBackend.get('/api/ai4s/settings').then((res) => res.data);
}

export async function updateSettings(
  payload: IAi4sUpdateSettingsRequest,
): Promise<IAi4sSettingsResponse> {
  return axiosForBackend.put('/api/ai4s/settings', payload).then((res) => res.data);
}

export async function fetchRuns(): Promise<IAi4sRunsResponse> {
  return axiosForBackend.get('/api/ai4s/runs').then((res) => res.data);
}

export async function fetchDigest(type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sDigestResponse> {
  const url = type === 'weekly' ? '/api/ai4s/digest?type=weekly' : '/api/ai4s/digest';
  return axiosForBackend.get(url).then((res) => res.data);
}

export async function saveDigest(
  payload: IAi4sSaveDigestRequest,
): Promise<IAi4sDigestResponse> {
  return axiosForBackend.post('/api/ai4s/digest', payload).then((res) => res.data);
}

export async function toggleSource(id: string): Promise<IAi4sSourcesResponse> {
  return axiosForBackend.patch(`/api/ai4s/sources/${id}/toggle`).then((res) => res.data);
}

export async function crawlSource(id: string): Promise<IAi4sIngestResult> {
  return axiosForBackend.post(`/api/ai4s/sources/${id}/crawl`).then((res) => res.data);
}

export async function startCrawlAll(): Promise<IAi4sCrawlAllStartResponse> {
  return axiosForBackend.post('/api/ai4s/sources/crawl-all').then((res) => res.data);
}

export async function analyzeUrl(payload: IAi4sAnalyzeUrlRequest): Promise<IAi4sIngestResult> {
  return axiosForBackend.post('/api/ai4s/articles/analyze', payload).then((res) => res.data);
}

export async function reanalyzeArticle(id: string): Promise<IAi4sIngestResult> {
  return axiosForBackend.post(`/api/ai4s/articles/${id}/reanalyze`).then((res) => res.data);
}

export async function pushDigest(type: 'daily' | 'weekly' = 'daily'): Promise<IAi4sPushResult> {
  const url = type === 'weekly' ? '/api/ai4s/push?type=weekly' : '/api/ai4s/push';
  return axiosForBackend.post(url).then((res) => res.data);
}

export async function testSource(id: string): Promise<IAi4sTestSourceResponse> {
  return axiosForBackend.post(`/api/ai4s/sources/${id}/test`).then((res) => res.data);
}

export async function startHealthCheck(): Promise<IAi4sHealthCheckStartResponse> {
  return axiosForBackend.post('/api/ai4s/sources/health-check').then((res) => res.data);
}

export async function fetchHealthCheckStats(): Promise<IAi4sHealthCheckStatsResponse> {
  return axiosForBackend.get('/api/ai4s/sources/health-check/stats').then((res) => res.data);
}

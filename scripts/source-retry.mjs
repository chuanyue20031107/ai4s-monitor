import { setTimeout as sleep } from 'node:timers/promises';

export const RETRY_DELAYS = Object.freeze([30_000, 120_000]);
export function retryable(error) {
  if (/HTTP_|robots|budget|private|invalid|unsupported|too_large|redirect_limit|needs_config|parse_failed/i.test(error?.message || '')) return false;
  const code = error?.cause?.code || error?.code || '';
  return ['TimeoutError', 'AbortError'].includes(error?.name)
    || /^(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(code)
    || /^(fetch failed|network_error|network error|timeout)$/i.test(error?.message || '');
}
export async function fetchWithRetry(fetcher, url, { wait = sleep, onRetry = () => {}, deadline = Infinity } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= deadline) throw new Error('request_budget_exhausted');
    try { return await fetcher(url); }
    catch (error) {
      if (attempt >= RETRY_DELAYS.length || !retryable(error)) throw error;
      if (Date.now() + RETRY_DELAYS[attempt] >= deadline) throw new Error('request_budget_exhausted');
      onRetry({ attempt: attempt + 1, delay: RETRY_DELAYS[attempt] });
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}

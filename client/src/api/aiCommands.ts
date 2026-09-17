import { REPOSITORY } from './sourceOperations';

export type AnalysisLimit = 100 | 500 | 'all';
export interface AICommand {
  schemaVersion: 1;
  id: string;
  type: 'analyze';
  limit: AnalysisLimit;
  instruction: string;
  query: string;
  createdAt: string;
}
export interface AICommandResult {
  id: string;
  instruction?: string;
  status: 'pending' | 'awaiting_analysis' | 'completed' | 'partial' | 'no_work' | 'rejected';
  total: number;
  completed: number;
  failed: number;
  pending: number;
  blocked: number;
  alreadyQueued: number;
  remaining?: number;
  reason?: string;
}
export interface AIQueueSnapshot { items: AICommandResult[]; pendingTasks: number }
export const AI_WORKER_URL = `https://github.com/${REPOSITORY}/actions/workflows/ai-analysis-worker.yml`;
export function createAICommand(instruction: string, limit: AnalysisLimit, query = ''): AICommand {
  return { schemaVersion: 1, id: crypto.randomUUID(), type: 'analyze', limit,
    instruction: instruction.trim(), query: query.trim(), createdAt: new Date().toISOString() };
}
export function commandCommitUrl(command: AICommand) {
  const params = new URLSearchParams({ filename: `data/ai-commands/pending/${command.id}.json`,
    value: `${JSON.stringify(command, null, 2)}\n` });
  return `https://github.com/${REPOSITORY}/new/main?${params}`;
}
export async function fetchAIQueue(): Promise<AIQueueSnapshot> {
  const urls = [`https://raw.githubusercontent.com/${REPOSITORY}/main/client/public/data/ai-commands.json?t=${Date.now()}`,
    `${import.meta.env.BASE_URL}data/ai-commands.json?t=${Date.now()}`];
  if (import.meta.env.DEV) urls.reverse();
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const result = await response.json() as AIQueueSnapshot;
      if (!Array.isArray(result.items) || !Number.isInteger(result.pendingTasks)) continue;
      return result;
    } catch { /* Fall back to the last published snapshot; do not invent successful requests. */ }
  }
  throw Error('无法读取任务队列，请重试或查看 GitHub Actions。');
}

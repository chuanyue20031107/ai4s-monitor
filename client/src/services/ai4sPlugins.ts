/** Analysis now runs in the authorized ChatGPT scheduled task, not the visitor's browser. */
export async function generateDailyDigestText(
  _prompt: string,
  _onChunk?: (full: string) => void,
): Promise<string> {
  throw new Error('摘要由 ChatGPT 定时分析任务生成并回写 GitHub；此按钮不再伪装成本地 AI 生成。请查看已发布日报与运行记录。');
}

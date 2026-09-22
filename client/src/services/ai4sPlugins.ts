/** Analysis is performed by the authorized Codex workspace, not in the visitor's browser. */
export async function generateDailyDigestText(
  _prompt: string,
  _onChunk?: (full: string) => void,
): Promise<string> {
  throw new Error('摘要由 Codex 工作区分析并写回项目数据；此按钮不在浏览器中生成摘要。请查看已发布日报与运行记录。');
}

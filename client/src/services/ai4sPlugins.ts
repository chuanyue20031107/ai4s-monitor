/** GitHub-native build: no proprietary capability client is used. */
export async function generateDailyDigestText(
  prompt: string,
  onChunk?: (full: string) => void,
): Promise<string> {
  const lines = prompt
    .split('\n')
    .filter((line) => /^\d+\. \[5分\]/.test(line))
    .slice(0, 20);
  const output = lines.length
    ? `【重点情报】\n\n${lines.join('\n\n')}\n\n【趋势观察】\n数据由 GitHub Actions 自动抓取，当前摘要为规则化本地生成。`
    : '【趋势观察】\n当前没有评分为 5 的重点情报；数据由 GitHub Actions 自动抓取。';
  onChunk?.(output);
  return output;
}

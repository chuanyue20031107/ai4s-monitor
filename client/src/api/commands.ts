export type SourceCommandAction = 'health_check' | 'crawl_source';

function commandPath(action: SourceCommandAction, sourceId: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `data/commands/pending/${action}-${sourceId}-${stamp}.json`;
}

/**
 * GitHub Pages cannot safely store a token, so commands are prepared as files.
 * The next step wires this writer to the repository write mechanism/approval flow.
 */
export function buildSourceCommand(action: SourceCommandAction, sourceId: string) {
  return {
    path: commandPath(action, sourceId),
    payload: {
      id: crypto.randomUUID(),
      action,
      sourceId,
      createdAt: new Date().toISOString(),
      status: 'pending',
    },
  };
}

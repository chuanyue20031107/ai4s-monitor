export type SourceCommandAction = 'health_check' | 'crawl_source';

export interface SourceCommandRequest {
  action: SourceCommandAction;
  sourceId: string;
}

/**
 * GitHub Pages cannot contain write tokens.
 * This builds the request contract consumed by the GitHub-native command workflow.
 */
export function createSourceCommandRequest(
  action: SourceCommandAction,
  sourceId: string,
): SourceCommandRequest {
  return {
    action,
    sourceId,
  };
}

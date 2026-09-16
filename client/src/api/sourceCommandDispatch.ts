export type SourceCommandAction = 'health_check' | 'crawl_source';

export interface SourceCommandRequest {
  action: SourceCommandAction;
  sourceId: string;
}

/**
 * GitHub Pages is static and does not keep repository credentials.
 * This contract is consumed by the GitHub-native dispatch workflow.
 */
export function createSourceCommandRequest(action: SourceCommandAction, sourceId: string): SourceCommandRequest {
  return {
    action,
    sourceId,
  };
}

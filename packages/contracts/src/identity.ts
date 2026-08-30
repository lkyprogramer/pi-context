export interface RuntimeCursor {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
}

export interface RuntimeCursorInput {
  workspacePath: string;
  sessionId: string;
  leafId: string | null;
  lineageEntryIds: readonly string[];
  modelKey: string;
}

export interface StableIdentityInput {
  cursor: RuntimeCursor;
  sourceEntryId: string;
  contentHash: string;
  toolCallId?: string;
}

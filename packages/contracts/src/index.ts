export * from "./canonical.js";
export * from "./errors.js";
export * from "./hash.js";
export * from "./ids.js";
export * from "./identity.js";
export * from "./package-boundary.js";
export * from "./providers.js";
export * from "./semantic.js";
export * from "./types.js";
export * from "./v2.js";

/** Stable internal callback shapes shared by host adapters and runtime wiring. */
export interface WorkspaceCallbackContext {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
}

export interface UserInputCallbackInput {
  operationId: string;
  cursor: HostSessionCursor;
  content: HostContentBlock[];
  capturedAt: number;
}

export interface CursorCallbackInput {
  cursor: HostSessionCursor;
  signal?: AbortSignal;
}

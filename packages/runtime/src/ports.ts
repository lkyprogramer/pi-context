import type {
  ActionAuthority,
  HostContentBlock,
  HostMessage,
  MaterializedView,
  RuntimeCursor,
  SourceClass,
  UserTurnRecord,
} from "@pcr/contracts";

export interface RuntimeSessionScope {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
}

export interface CancellableRuntimeOperation {
  operationId: string;
  cursor: RuntimeCursor;
  signal?: AbortSignal;
}

export interface UserInputEvent extends CancellableRuntimeOperation {
  rawText: string;
  sourceClass: "authenticated-user" | "untrusted-user";
  capturedAt: number;
  hostMessageId?: string;
}

export interface UserInputReceipt extends UserTurnRecord {
  operationId: string;
}

export interface ToolObservation extends CancellableRuntimeOperation {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: HostContentBlock[];
  details: unknown;
  isError: boolean;
  capturedAt: number;
  sourceClass: Extract<SourceClass, "trusted-tool" | "untrusted-tool">;
  authority: ActionAuthority;
}

export interface ProjectedToolResult {
  operationId: string;
  observationId: string;
  rawBlobId: string;
  evidenceIds: string[];
  visibleContent: HostContentBlock[];
  isError: boolean;
  reducer: { id: string; revision: string };
}

export interface MaterializationRequest extends CancellableRuntimeOperation {
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
}

export interface UserInputPort {
  capture(input: UserInputEvent): Promise<UserInputReceipt>;
}

export interface ToolResultPort {
  ingest(input: ToolObservation): Promise<ProjectedToolResult>;
}

export interface MaterializationPort {
  materialize(input: MaterializationRequest): Promise<MaterializedView>;
}

export interface RuntimeSessionPorts {
  userInput: UserInputPort;
  toolResult: ToolResultPort;
  materialization: MaterializationPort;
}

export interface RuntimeSession {
  ingestUserInput(input: UserInputEvent): Promise<UserInputReceipt>;
  ingestToolResult(input: ToolObservation): Promise<ProjectedToolResult>;
  materialize(input: MaterializationRequest): Promise<MaterializedView>;
}

export type RuntimeSessionErrorCode =
  | "PCR_RUNTIME_DEPENDENCY_MISSING"
  | "PCR_RUNTIME_INPUT_INVALID"
  | "PCR_RUNTIME_SCOPE_MISMATCH";

export class RuntimeSessionError extends TypeError {
  readonly code: RuntimeSessionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RuntimeSessionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RuntimeSessionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

import type { ActionAuthority, HostContentBlock, RuntimeCursor, SourceClass } from "@pcr/contracts";

export interface ToolObservation {
  operationId: string;
  cursor: RuntimeCursor;
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: HostContentBlock[];
  details: unknown;
  isError: boolean;
  capturedAt: number;
  sourceClass: Extract<SourceClass, "trusted-tool" | "untrusted-tool">;
  authority: ActionAuthority;
  signal?: AbortSignal;
}

export interface ReducerInput {
  observation: ToolObservation;
  text: string;
  rawBlobId?: string;
  cursor: RuntimeCursor;
  signal?: AbortSignal;
}

export interface ReducerOutput {
  visibleText: string;
  facts: unknown[];
  artifacts?: unknown[];
  details?: unknown;
  diagnostics?: unknown[];
  fallback?: boolean;
}

export interface Reducer {
  readonly id: string;
  supports(input: ToolObservation): boolean;
  reduce(input: ReducerInput): Promise<ReducerOutput>;
}

export interface ReducedObservation extends ReducerOutput {
  reducer: { id: string };
}

export interface CreateReducerRegistryInput {
  cursor: RuntimeCursor;
  reducers: readonly Reducer[];
}

export type ReducerRegistryErrorCode =
  | "PCR_REDUCER_DEPENDENCY_MISSING"
  | "PCR_REDUCER_INPUT_INVALID"
  | "PCR_REDUCER_SCOPE_MISMATCH"
  | "PCR_REDUCER_UNSUPPORTED";

export class ReducerRegistryError extends TypeError {
  readonly code: ReducerRegistryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ReducerRegistryErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ReducerRegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

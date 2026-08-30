export interface CapturedTrace {
  traceId: string;
  clusterId: string;
  sessionJsonlHash: string;
  workspaceSnapshotHash: string;
  redactionReportHash: string;
}

export interface RedactionReplacement {
  kind: "token" | "email" | "path";
  count: number;
}

export interface RedactionReport {
  replacements: readonly RedactionReplacement[];
}

export interface TraceArtifacts {
  sessionJsonl: string;
  workspaceSnapshot: unknown;
  redactionReport: RedactionReport;
}

export interface TraceCaptureStore {
  write(trace: CapturedTrace, artifacts: TraceArtifacts): Promise<void>;
}

export interface CaptureTraceInput {
  clusterId: string;
  workspaceId: string;
  sessionId: string;
  sessionJsonl: string;
  workspaceSnapshot: unknown;
  signal?: AbortSignal;
}

export interface TraceCapture {
  capture(input: CaptureTraceInput): Promise<CapturedTrace>;
}

export interface CreateTraceCaptureInput {
  corpusId: string;
  clusters: Readonly<Record<string, readonly string[]>>;
  store: TraceCaptureStore;
}

export interface CreateFileTraceStoreInput {
  root: string;
  corpusId: string;
}

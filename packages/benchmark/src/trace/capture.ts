import { domainHash } from "@pcr/contracts";

import { failInput, failMissing, failScope } from "./errors.js";
import { emptyCounts, redactString, redactValue, toReport } from "./redact.js";
import type {
  CapturedTrace,
  CaptureTraceInput,
  CreateTraceCaptureInput,
  TraceCapture,
  TraceCaptureStore,
} from "./types.js";

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotClusters(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) failMissing("clusters");
  const next: Record<string, readonly string[]> = {};
  for (const [name, ids] of Object.entries(value as Record<string, unknown>)) {
    requireNonEmpty(name, "clusters");
    if (!Array.isArray(ids) || ids.length === 0) failInput(`clusters.${name}`);
    next[name] = ids.map((id, index) => {
      requireNonEmpty(id, `clusters.${name}[${index}]`);
      return id;
    });
  }
  if (Object.keys(next).length === 0) failMissing("clusters");
  return Object.freeze(next);
}

function snapshotStore(store: unknown): TraceCaptureStore {
  if (!store || typeof store !== "object") failMissing("store");
  const candidate = store as TraceCaptureStore;
  if (typeof candidate.write !== "function") failMissing("store.write");
  return candidate;
}

function freezeTrace(trace: CapturedTrace): CapturedTrace {
  return Object.freeze({
    traceId: trace.traceId,
    clusterId: trace.clusterId,
    sessionJsonlHash: trace.sessionJsonlHash,
    workspaceSnapshotHash: trace.workspaceSnapshotHash,
    redactionReportHash: trace.redactionReportHash,
  });
}

function parseJsonl(raw: string, workspaceId: string, sessionId: string): unknown[] {
  const lines = raw.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length === 0) failInput("sessionJsonl");
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      failInput(`sessionJsonl[${index}]`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) failInput(`sessionJsonl[${index}]`);
    const row = parsed as { workspaceId?: unknown; sessionId?: unknown };
    if (typeof row.workspaceId === "string" && row.workspaceId !== workspaceId) {
      failScope({ field: "workspaceId", expected: workspaceId, actual: row.workspaceId });
    }
    if (typeof row.sessionId === "string" && row.sessionId !== sessionId) {
      failScope({ field: "sessionId", expected: sessionId, actual: row.sessionId });
    }
    return parsed;
  });
}

export function createTraceCapture(input: CreateTraceCaptureInput): TraceCapture {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const corpusId = input.corpusId;
  const clusters = snapshotClusters(input.clusters);
  const store = snapshotStore(input.store);
  return {
    async capture(request: CaptureTraceInput): Promise<CapturedTrace> {
      if (!request || typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      requireNonEmpty(request.clusterId, "clusterId");
      if (!clusters[request.clusterId]) failInput("clusterId");
      requireNonEmpty(request.workspaceId, "workspaceId");
      requireNonEmpty(request.sessionId, "sessionId");
      if (typeof request.sessionJsonl !== "string" || request.sessionJsonl.length === 0) failInput("sessionJsonl");
      if (request.workspaceSnapshot === undefined) failInput("workspaceSnapshot");
      const counts = emptyCounts();
      const rows = parseJsonl(request.sessionJsonl, request.workspaceId, request.sessionId);
      const redactedRows = rows.map((row) => redactValue(row, counts));
      const sessionJsonl = `${redactedRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      const workspaceSnapshot = redactValue(request.workspaceSnapshot, counts);
      const redactionReport = toReport(counts);
      const sessionJsonlHash = domainHash("trace.session-jsonl", sessionJsonl);
      const workspaceSnapshotHash = domainHash("trace.workspace-snapshot", workspaceSnapshot);
      const redactionReportHash = domainHash("trace.redaction-report", redactionReport);
      const trace = freezeTrace({
        clusterId: request.clusterId,
        sessionJsonlHash,
        workspaceSnapshotHash,
        redactionReportHash,
        traceId: domainHash("trace.id", {
          corpusId,
          clusterId: request.clusterId,
          sessionId: request.sessionId,
          sessionJsonlHash,
          workspaceSnapshotHash,
          redactionReportHash,
        }),
      });
      if (JSON.stringify(trace).includes("sk-") || sessionJsonl.includes("sk-live") || redactString(sessionJsonl, emptyCounts()) !== sessionJsonl) {
        failInput("redaction");
      }
      request.signal?.throwIfAborted();
      await store.write(trace, { sessionJsonl, workspaceSnapshot, redactionReport });
      return trace;
    },
  };
}

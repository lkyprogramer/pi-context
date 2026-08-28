import { createHash } from "node:crypto";
import {
  defineBenchmarkContracts,
  sha256Canonical,
  type RawTrace,
  type RawTraceEntry,
} from "../../benchmark-contracts/src/index.js";
import { decodeSessionEntry, normalizeTimestamp } from "./pi-message-codec.js";

export const PI_VERSION = "0.84.3";
export const PI_COMMIT = "ccfe79ed238674f760c986e3a61493aab794000a";

export interface RawToolObservation {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
}

export interface RawTraceCaptureInput {
  sessionId: string;
  branchLeafId: string;
  sessionEntries: readonly unknown[];
  rawToolObservations: ReadonlyMap<string, RawToolObservation>;
  modelRoute: ModelRoute;
  systemPromptHash: string;
  toolSchemaHash: string;
  scenarioId?: string;
  seed?: number;
  workspaceSnapshotSha256?: string;
  signal?: AbortSignal;
}

export interface ReplayMessage {
  readonly entryId: string;
  readonly role: string;
  readonly contentSha256: string;
  readonly toolCallId?: string;
}

export interface ReplaySink {
  onMessage(message: ReplayMessage): void | Promise<void>;
}

export interface ReplayReceipt {
  readonly messageDigest: string;
  readonly branchLeafId: string;
  readonly entryCount: number;
  readonly cancelled: boolean;
}

export interface RawTraceCaptureReceipt {
  readonly hiddenReasoningPresent: boolean;
  readonly hiddenReasoningLength: number;
  readonly degradedToolResults: readonly string[];
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("aborted");
  }
}

function digestEntries(entries: readonly RawTraceEntry[]): readonly Record<string, unknown>[] {
  return entries.map((entry) => ({
    entryId: entry.entryId,
    role: entry.role,
    contentSha256: entry.contentSha256,
    toolCallId: typeof entry.toolCallId === "string" ? entry.toolCallId : null,
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : null,
  }));
}

export function computeMessageDigest(trace: Pick<RawTrace, "entries" | "boundary">): string {
  return sha256Canonical({
    branchLeafId: trace.boundary.leafId,
    entries: digestEntries(trace.entries),
  });
}

export async function captureRawTrace(input: RawTraceCaptureInput): Promise<RawTrace> {
  assertNotAborted(input.signal);
  const entries: RawTraceEntry[] = [];
  const degradedToolResults: string[] = [];
  let hiddenReasoningLength = 0;

  for (const raw of input.sessionEntries) {
    assertNotAborted(input.signal);
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if ("oracle" in record || "hiddenContinuation" in record) {
      continue;
    }
    const decoded = decodeSessionEntry(raw);
    if (!decoded.id || decoded.type === "session") {
      continue;
    }
    const message = record.message !== null && typeof record.message === "object" ? (record.message as Record<string, unknown>) : {};
    const reasoning = message.reasoning ?? record.reasoning;
    if (typeof reasoning === "string") {
      hiddenReasoningLength += reasoning.length;
    }

    let content = decoded.contentText;
    let degraded = false;
    if ((decoded.role === "toolResult" || decoded.type === "message") && decoded.toolCallId) {
      const observation = input.rawToolObservations.get(decoded.toolCallId);
      if (observation) {
        content = new TextDecoder().decode(observation.bytes);
      } else if (decoded.role === "toolResult") {
        degraded = true;
        degradedToolResults.push(decoded.id);
      }
    }

    const entry: RawTraceEntry = {
      entryId: decoded.id,
      role: decoded.role ?? decoded.type,
      contentSha256: sha256(content),
      ...(decoded.toolCallId ? { toolCallId: decoded.toolCallId } : {}),
      ...(decoded.toolName ? { toolName: decoded.toolName } : {}),
      timestamp: normalizeTimestamp(decoded.timestamp),
      parentId: decoded.parentId,
      ...(degraded ? { degraded: true } : {}),
    };
    entries.push(entry);
  }

  const trace = {
    traceId: `trace:${input.sessionId}`,
    scenarioId: input.scenarioId ?? input.sessionId,
    seed: input.seed ?? 0,
    pi: { version: PI_VERSION, commit: PI_COMMIT },
    rawTraceSha256: sha256Canonical({
      modelRoute: input.modelRoute,
      systemPromptHash: input.systemPromptHash,
      toolSchemaHash: input.toolSchemaHash,
      entries: digestEntries(entries),
    }),
    entries,
    boundary: {
      leafId: input.branchLeafId,
      kind: "pre-threshold" as const,
      sourceTokens: Math.max(0, entries.reduce((sum, entry) => sum + entry.contentSha256.length, 0)),
    },
    workspaceSnapshotSha256: input.workspaceSnapshotSha256 ?? "0".repeat(64),
    messageDigest: computeMessageDigest({ entries, boundary: { leafId: input.branchLeafId, kind: "pre-threshold", sourceTokens: 0 } }),
  };

  assertNotAborted(input.signal);
  const parsed = defineBenchmarkContracts().parseRawTrace(trace);
  void hiddenReasoningLength;
  void degradedToolResults;
  return parsed;
}

export async function replayRawTrace(
  trace: RawTrace,
  sink: ReplaySink,
  signal?: AbortSignal,
): Promise<ReplayReceipt> {
  assertNotAborted(signal);
  for (const entry of trace.entries) {
    assertNotAborted(signal);
    await sink.onMessage({
      entryId: entry.entryId,
      role: entry.role,
      contentSha256: entry.contentSha256,
      toolCallId: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
    });
  }
  return {
    messageDigest: computeMessageDigest(trace),
    branchLeafId: trace.boundary.leafId,
    entryCount: trace.entries.length,
    cancelled: false,
  };
}

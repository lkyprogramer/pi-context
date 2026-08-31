import { createHash } from "node:crypto";

export interface IntegrityScore {
  directiveCoverage: number;
  toolPairViolations: number;
  recoveryRate: number;
  deterministicHashStable: boolean;
}

export interface IntegrityPair {
  toolCallId: string;
  toolName: string;
}

export interface IntegrityRecovery {
  blobId: string;
  expectedSha256: string;
  expectedBytes: number;
  mustOmitLeak?: boolean;
}

export interface IntegritySample {
  workspaceId: string;
  sessionId: string;
  directives: { expected: readonly string[]; observed: readonly string[] };
  pairs: { calls: readonly IntegrityPair[]; results: readonly IntegrityPair[] };
  recoveries: readonly IntegrityRecovery[];
  hashes: { first: string; second: string };
  signal?: AbortSignal;
}

export interface IntegrityBlobStore {
  read(scope: { workspaceId: string; sessionId: string }, blobId: string): Promise<Uint8Array>;
}

export interface IntegrityScorer {
  score(sample: IntegritySample): Promise<IntegrityScore>;
}

export type IntegrityErrorCode =
  | "PCR_INTEGRITY_DEPENDENCY_MISSING"
  | "PCR_INTEGRITY_INPUT_INVALID"
  | "PCR_INTEGRITY_SCOPE_MISMATCH";

export class IntegrityScorerError extends TypeError {
  readonly code: IntegrityErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: IntegrityErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "IntegrityScorerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function failMissing(dependency: string): never {
  throw new IntegrityScorerError("PCR_INTEGRITY_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new IntegrityScorerError("PCR_INTEGRITY_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new IntegrityScorerError("PCR_INTEGRITY_SCOPE_MISMATCH", details);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function createIntegrityScorer(input: { blobs: IntegrityBlobStore }): IntegrityScorer {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.blobs || typeof input.blobs.read !== "function") failMissing("blobs");
  const blobs = input.blobs;
  return {
    async score(sample: IntegritySample): Promise<IntegrityScore> {
      if (!sample || typeof sample !== "object") failInput("sample");
      requireNonEmpty(sample.workspaceId, "workspaceId");
      requireNonEmpty(sample.sessionId, "sessionId");
      if (!sample.directives || !Array.isArray(sample.directives.expected) || !Array.isArray(sample.directives.observed)) {
        failInput("directives");
      }
      if (!sample.pairs || !Array.isArray(sample.pairs.calls) || !Array.isArray(sample.pairs.results)) failInput("pairs");
      if (!Array.isArray(sample.recoveries)) failInput("recoveries");
      if (!sample.hashes || typeof sample.hashes !== "object") failInput("hashes");
      requireNonEmpty(sample.hashes.first, "hashes.first");
      requireNonEmpty(sample.hashes.second, "hashes.second");
      if (!SHA256_PATTERN.test(sample.hashes.first) || !SHA256_PATTERN.test(sample.hashes.second)) failInput("hashes");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      const expected = sample.directives.expected.filter((item) => typeof item === "string" && item.length > 0);
      const observed = new Set(sample.directives.observed.filter((item) => typeof item === "string"));
      const directiveCoverage = expected.length === 0 ? 1 : expected.filter((item) => observed.has(item)).length / expected.length;
      const calls = sample.pairs.calls.map((row, index) => {
        if (!row || typeof row.toolCallId !== "string" || typeof row.toolName !== "string") failInput(`pairs.calls[${index}]`);
        return row;
      });
      const results = sample.pairs.results.map((row, index) => {
        if (!row || typeof row.toolCallId !== "string" || typeof row.toolName !== "string") failInput(`pairs.results[${index}]`);
        return row;
      });
      const resultById = new Map(results.map((row) => [row.toolCallId, row]));
      let toolPairViolations = 0;
      const seen = new Set<string>();
      for (const call of calls) {
        const result = resultById.get(call.toolCallId);
        if (!result || result.toolName !== call.toolName) toolPairViolations += 1;
        seen.add(call.toolCallId);
      }
      for (const result of results) {
        if (!seen.has(result.toolCallId)) toolPairViolations += 1;
      }
      let recovered = 0;
      for (const item of sample.recoveries) {
        if (!item || typeof item !== "object") failInput("recoveries[]");
        requireNonEmpty(item.blobId, "recoveries.blobId");
        requireNonEmpty(item.expectedSha256, "recoveries.expectedSha256");
        if (!SHA256_PATTERN.test(item.expectedSha256)) failInput("recoveries.expectedSha256");
        if (!Number.isSafeInteger(item.expectedBytes) || item.expectedBytes < 0) failInput("recoveries.expectedBytes");
        sample.signal?.throwIfAborted();
        let bytes: Uint8Array;
        try {
          bytes = await blobs.read({ workspaceId: sample.workspaceId, sessionId: sample.sessionId }, item.blobId);
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
            failScope({ blobId: item.blobId, workspaceId: sample.workspaceId });
          }
          throw error;
        }
        const digest = sha256(bytes);
        if (digest === item.expectedSha256 && bytes.byteLength === item.expectedBytes) recovered += 1;
      }
      const recoveryRate = sample.recoveries.length === 0 ? 1 : recovered / sample.recoveries.length;
      return Object.freeze({
        directiveCoverage,
        toolPairViolations,
        recoveryRate,
        deterministicHashStable: sample.hashes.first === sample.hashes.second,
      });
    },
  };
}

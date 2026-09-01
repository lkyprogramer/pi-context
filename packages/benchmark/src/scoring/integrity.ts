import { createHash } from "node:crypto";

export interface IntegrityScore {
  directiveCoverage: number;
  toolPairViolations: number;
  recoveryRate: number;
  deterministicHashStable: boolean;
}

export interface LeakSurfaceScore {
  leakCount: number;
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
  secrets?: readonly string[];
  surfaces?: readonly string[];
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

export function scoreLeakSurfaces(secrets: readonly string[], surfaces: readonly string[]): LeakSurfaceScore {
  return { leakCount: countLeaks(secrets, surfaces) };
}

function countLeaks(secrets: readonly string[], surfaces: readonly string[]): number {
  if (secrets.length === 0) return 0;
  const joined = surfaces.join("");
  let leaks = 0;
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length === 0) continue;
    if (surfaces.some((text) => typeof text === "string" && text.includes(secret))) {
      leaks += 1;
      continue;
    }
    if (joined.includes(secret)) {
      leaks += 1;
      continue;
    }
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    if (surfaces.some((text) => typeof text === "string" && text.includes(encoded))) leaks += 1;
  }
  return leaks;
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

const SCOPE_DENIED = new Set([
  "PCR_RETRIEVAL_SCOPE_DENIED",
  "PCR_INTEGRITY_SCOPE_MISMATCH",
  "PCR_BLOB_WORKSPACE_MISMATCH",
  "PCR_BLOB_SCOPE_MISMATCH",
  "PCR_POINTER_SCOPE_MISMATCH",
]);

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

export type ExactRecoveryStatus = "ok" | "n/a" | "failed";

export interface ExactRecoveryPointer {
  blobId: string;
  expectedSha256: string;
  expectedBytes: number;
}

export interface ExactRecoveryReport {
  recovered: boolean;
  status: ExactRecoveryStatus;
  recoveredCount: number;
  denominator: number;
  crossScopeDenied: boolean;
  reasons: readonly string[];
}

export async function scoreExactRecovery(input: {
  blobs: IntegrityBlobStore;
  workspaceId: string;
  sessionId: string;
  wrongWorkspaceId: string;
  wrongSessionId: string;
  pointers: readonly ExactRecoveryPointer[];
  fromExtension?: boolean;
  mustOmitLeak?: boolean;
  signal?: AbortSignal;
}): Promise<ExactRecoveryReport> {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.blobs || typeof input.blobs.read !== "function") failMissing("blobs");
  requireNonEmpty(input.workspaceId, "workspaceId");
  requireNonEmpty(input.sessionId, "sessionId");
  requireNonEmpty(input.wrongWorkspaceId, "wrongWorkspaceId");
  requireNonEmpty(input.wrongSessionId, "wrongSessionId");
  if (!Array.isArray(input.pointers)) failInput("pointers");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  const reasons: string[] = [];
  if (input.fromExtension === true && input.pointers.length === 0 && input.mustOmitLeak !== true) {
    reasons.push("fromExtension-without-cas-read");
  }
  if (input.pointers.length === 0) {
    return Object.freeze({
      recovered: false,
      status: "n/a" as const,
      recoveredCount: 0,
      denominator: 0,
      crossScopeDenied: false,
      reasons: Object.freeze([...reasons, "zero-pointer"]),
    });
  }
  let recoveredCount = 0;
  let deniedCount = 0;
  let inScopeReads = 0;
  for (const pointer of input.pointers) {
    if (!pointer || typeof pointer !== "object") failInput("pointers[]");
    requireNonEmpty(pointer.blobId, "pointers.blobId");
    requireNonEmpty(pointer.expectedSha256, "pointers.expectedSha256");
    if (!SHA256_PATTERN.test(pointer.expectedSha256)) failInput("pointers.expectedSha256");
    if (!Number.isSafeInteger(pointer.expectedBytes) || pointer.expectedBytes < 0) {
      failInput("pointers.expectedBytes");
    }
    input.signal?.throwIfAborted();
    let bytes: Uint8Array;
    try {
      bytes = await input.blobs.read(
        { workspaceId: input.workspaceId, sessionId: input.sessionId },
        pointer.blobId,
      );
    } catch (error) {
      reasons.push(`read-failed:${errorCode(error) ?? "unknown"}`);
      continue;
    }
    inScopeReads += 1;
    const digest = sha256(bytes);
    const hashOk = digest === pointer.expectedSha256;
    const lengthOk = bytes.byteLength === pointer.expectedBytes;
    if (hashOk && lengthOk) recoveredCount += 1;
    else reasons.push(`mismatch:${pointer.blobId}`);
    try {
      const leaked = await input.blobs.read(
        { workspaceId: input.wrongWorkspaceId, sessionId: input.wrongSessionId },
        pointer.blobId,
      );
      if (leaked) reasons.push(`cross-scope-allowed:${pointer.blobId}`);
    } catch (error) {
      const code = errorCode(error);
      if (code && (SCOPE_DENIED.has(code) || code.includes("SCOPE") || code.includes("MISMATCH"))) {
        deniedCount += 1;
      } else {
        reasons.push(`cross-scope-wrong-error:${code ?? "unknown"}`);
      }
    }
  }
  const crossScopeDenied = inScopeReads > 0 && deniedCount === inScopeReads;
  const casOk = recoveredCount === input.pointers.length && crossScopeDenied;
  const recovered = casOk && input.mustOmitLeak !== true;
  if (input.mustOmitLeak === true) reasons.push("must-omit-leak");
  return Object.freeze({
    recovered,
    status: recovered ? "ok" : "failed",
    recoveredCount,
    denominator: input.pointers.length,
    crossScopeDenied,
    reasons: Object.freeze(reasons),
  });
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

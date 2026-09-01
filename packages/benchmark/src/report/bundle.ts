import { createHash } from "node:crypto";

import { GateEngineError, type GateDecision, type RunBundle } from "./engine.js";

export type BundleVerifyErrorCode =
  | "PCR_BUNDLE_TAMPERED"
  | "PCR_BUNDLE_ABSOLUTE_PATH"
  | "PCR_BUNDLE_INPUT_INVALID"
  | "PCR_BUNDLE_RAW_MISSING"
  | "PCR_BUNDLE_PREVIEW_ONLY"
  | "PCR_BUNDLE_FAILED_SAMPLE_DELETED";

export class BundleVerifyError extends TypeError {
  readonly code: BundleVerifyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: BundleVerifyErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "BundleVerifyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code: BundleVerifyErrorCode, details: Record<string, unknown> = {}): never {
  throw new BundleVerifyError(code, details);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export interface ImmutableRunBundle {
  bundle: Omit<RunBundle, "signal">;
  decision: GateDecision;
  contentHash: string;
}

export function hashRunBundle(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function sealRunBundle(bundle: Omit<RunBundle, "signal">, decision: GateDecision): ImmutableRunBundle {
  if (!bundle || typeof bundle !== "object") fail("PCR_BUNDLE_INPUT_INVALID", { field: "bundle" });
  if (!decision || typeof decision !== "object") fail("PCR_BUNDLE_INPUT_INVALID", { field: "decision" });
  const sealed = { bundle, decision };
  return { ...sealed, contentHash: hashRunBundle(sealed) };
}

export function verifyRunBundle(input: ImmutableRunBundle, rescore?: (bundle: Omit<RunBundle, "signal">) => GateDecision): ImmutableRunBundle {
  if (!input || typeof input !== "object") fail("PCR_BUNDLE_INPUT_INVALID");
  if (typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.contentHash)) {
    fail("PCR_BUNDLE_TAMPERED", { field: "contentHash" });
  }
  const expected = hashRunBundle({ bundle: input.bundle, decision: input.decision });
  if (expected !== input.contentHash) fail("PCR_BUNDLE_TAMPERED", { expected, actual: input.contentHash });
  walkPaths(input.bundle);
  if (rescore) {
    const second = rescore(input.bundle);
    if (second.decision !== input.decision.decision || second.reportSha256 !== input.decision.reportSha256) {
      fail("PCR_BUNDLE_TAMPERED", { field: "rescore" });
    }
  }
  return input;
}

function walkPaths(value: unknown): void {
  if (typeof value === "string") {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value)) {
      throw new BundleVerifyError("PCR_BUNDLE_ABSOLUTE_PATH", { path: value });
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkPaths(item);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) walkPaths(item);
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PREVIEW_LIMIT = 400;

export interface RawRunBundle {
  sessionJsonl: string;
  storeSnapshotSha256: string;
  workspaceManifestSha256: string;
  configIdentity: string;
  modelIdentity: string;
  providerIdentity: string;
  rawReport: unknown;
  decision: unknown;
}

export function verifyRawRunBundle(input: RawRunBundle): RawRunBundle {
  if (!input || typeof input !== "object") fail("PCR_BUNDLE_INPUT_INVALID");
  if (typeof input.sessionJsonl !== "string" || input.sessionJsonl.length === 0) {
    fail("PCR_BUNDLE_RAW_MISSING", { field: "sessionJsonl" });
  }
  if (input.sessionJsonl.length <= PREVIEW_LIMIT) {
    fail("PCR_BUNDLE_PREVIEW_ONLY", { field: "sessionJsonl", bytes: input.sessionJsonl.length });
  }
  for (const field of ["storeSnapshotSha256", "workspaceManifestSha256"] as const) {
    if (typeof input[field] !== "string" || !SHA256_PATTERN.test(input[field])) {
      fail("PCR_BUNDLE_RAW_MISSING", { field });
    }
  }
  for (const field of ["configIdentity", "modelIdentity", "providerIdentity"] as const) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      fail("PCR_BUNDLE_RAW_MISSING", { field });
    }
  }
  if (input.rawReport === undefined || input.rawReport === null) fail("PCR_BUNDLE_RAW_MISSING", { field: "rawReport" });
  if (input.decision === undefined || input.decision === null) fail("PCR_BUNDLE_RAW_MISSING", { field: "decision" });
  walkPaths(input);
  return input;
}

export function scrubSecretsWithProvenance(text: string, secrets: readonly string[]): {
  text: string;
  provenance: ReadonlyArray<{ sha256: string; count: number }>;
} {
  if (typeof text !== "string") fail("PCR_BUNDLE_INPUT_INVALID", { field: "text" });
  if (!Array.isArray(secrets)) fail("PCR_BUNDLE_INPUT_INVALID", { field: "secrets" });
  let out = text;
  const provenance: Array<{ sha256: string; count: number }> = [];
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length === 0) continue;
    const digest = createHash("sha256").update(secret, "utf8").digest("hex");
    const token = `[redacted:sha256:${digest}]`;
    let count = 0;
    if (out.includes(secret)) {
      count = out.split(secret).length - 1;
      out = out.split(secret).join(token);
    }
    if (count > 0) provenance.push({ sha256: digest, count });
  }
  return { text: out, provenance: Object.freeze(provenance.map((row) => Object.freeze(row))) };
}

void GateEngineError;

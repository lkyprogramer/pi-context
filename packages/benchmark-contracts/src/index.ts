import { createHash } from "node:crypto";

export const CONTRACT_VERSION = "1.0.0" as const;

export const ORACLE_POLARITIES = ["must", "must-not", "may", "is", "is-not", "unknown"] as const;
export const ORACLE_STATUSES = ["active", "superseded", "resolved", "retracted", "contested", "unknown"] as const;
export const ORACLE_VISIBILITIES = ["must-visible", "recallable", "must-omit"] as const;
export const ORACLE_RISKS = ["ordinary", "hard-directive", "high-risk-outcome", "secret"] as const;
export const BOUNDARY_KINDS = [
  "pre-threshold",
  "native-threshold",
  "overflow-recovery",
  "semantic-boundary",
  "branch-boundary",
  "single-huge-turn",
] as const;
export const ARM_STAGES = ["w1", "w2", "semantic", "oracle"] as const;
export const ARM_INGRESS = ["pass-through", "w1"] as const;
export const ARM_RECALL = ["off", "manual-only", "proactive"] as const;
export const ARM_COMPACTORS = ["pi-native", "pcr-deterministic", "pcr-semantic", "none"] as const;
export const ARM_MATERIALIZERS = ["off", "identity", "pcr-deterministic", "pcr-semantic"] as const;
export const REPORT_STAGES = ["w1", "w2", "semantic"] as const;
export const GATE_NAMES = ["w1-early-net-value", "w2-compactor", "semantic-beta"] as const;
export const GATE_DECISIONS = [
  "proceed-to-w2",
  "keep-reducers-only",
  "keep-recovery-only",
  "stop",
  "repeat-after-infrastructure-fix",
  "adopt-pcr-compactor",
  "keep-pi-native",
  "proceed-to-semantic",
] as const;

export const ORACLE_REQUIRED = ["scenarioId", "oracleVersion", "items", "environmentAssertions", "forbiddenActions"] as const;
export const ORACLE_ITEM_REQUIRED = [
  "id",
  "kind",
  "canonical",
  "polarity",
  "status",
  "sourceRefs",
  "visibility",
  "risk",
  "aliases",
  "supersededBy",
] as const;
export const RAW_TRACE_REQUIRED = [
  "traceId",
  "scenarioId",
  "seed",
  "pi",
  "rawTraceSha256",
  "entries",
  "boundary",
  "workspaceSnapshotSha256",
] as const;
export const BOUNDARY_SNAPSHOT_REQUIRED = ["workspaceSnapshotSha256", "boundary"] as const;
export const BOUNDARY_REQUIRED = ["leafId", "kind", "sourceTokens"] as const;
export const ARM_MANIFEST_REQUIRED = [
  "armId",
  "stage",
  "ingress",
  "recall",
  "compactor",
  "materializer",
  "configSha256",
] as const;
export const COMPRESSION_ARTIFACT_REQUIRED = [
  "runId",
  "scenarioId",
  "armId",
  "outputHash",
  "sourceTraceHash",
  "boundaryLeafId",
  "visibleTokens",
  "messages",
  "evidenceRefs",
  "omissions",
] as const;
export const RUN_MANIFEST_REQUIRED = [
  "runId",
  "createdAt",
  "configSha256",
  "corpusSha256",
  "piVersion",
  "piCommit",
  "nodeVersion",
  "os",
  "arch",
  "arms",
  "seeds",
] as const;
export const BENCHMARK_REPORT_REQUIRED = [
  "runId",
  "stage",
  "baselineArm",
  "candidateArms",
  "hardGatePass",
  "qualityCiLower",
  "qualityMargin",
  "medianTokenDelta",
  "realizedNetMedian",
  "failures",
  "artifactHashes",
] as const;
export const GATE_DECISION_REQUIRED = ["runId", "gate", "decision", "hardGatePass", "reasons", "reportSha256"] as const;

export const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";

export type OraclePolarity = (typeof ORACLE_POLARITIES)[number];
export type OracleStatus = (typeof ORACLE_STATUSES)[number];
export type OracleVisibility = (typeof ORACLE_VISIBILITIES)[number];
export type OracleRisk = (typeof ORACLE_RISKS)[number];
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];
export type ArmStage = (typeof ARM_STAGES)[number];
export type ArmIngress = (typeof ARM_INGRESS)[number];
export type ArmRecall = (typeof ARM_RECALL)[number];
export type ArmCompactor = (typeof ARM_COMPACTORS)[number];
export type ArmMaterializer = (typeof ARM_MATERIALIZERS)[number];
export type ReportStage = (typeof REPORT_STAGES)[number];
export type GateName = (typeof GATE_NAMES)[number];
export type GateDecisionKind = (typeof GATE_DECISIONS)[number];

export interface OracleItem {
  readonly id: string;
  readonly kind: string;
  readonly canonical: unknown;
  readonly polarity: OraclePolarity;
  readonly status: OracleStatus;
  readonly sourceRefs: readonly string[];
  readonly visibility: OracleVisibility;
  readonly risk: OracleRisk;
  readonly aliases: readonly string[];
  readonly supersededBy: string | null;
}

export interface EnvironmentAssertion {
  readonly id: string;
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface ForbiddenAction {
  readonly id: string;
  readonly pattern: string;
  readonly [key: string]: unknown;
}

export interface Oracle {
  readonly scenarioId: string;
  readonly oracleVersion: string;
  readonly items: readonly OracleItem[];
  readonly environmentAssertions: readonly EnvironmentAssertion[];
  readonly forbiddenActions: readonly ForbiddenAction[];
}

export interface Boundary {
  readonly leafId: string;
  readonly kind: BoundaryKind;
  readonly sourceTokens: number;
}

export interface RawTraceEntry {
  readonly entryId: string;
  readonly role: string;
  readonly contentSha256: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface RawTrace {
  readonly traceId: string;
  readonly scenarioId: string;
  readonly seed: number;
  readonly pi: { readonly version: string; readonly commit: string };
  readonly rawTraceSha256: string;
  readonly entries: readonly RawTraceEntry[];
  readonly boundary: Boundary;
  readonly workspaceSnapshotSha256: string;
  readonly messageDigest?: string;
}

export interface BoundarySnapshot {
  readonly workspaceSnapshotSha256: string;
  readonly boundary: Boundary;
  readonly snapshotId?: string;
  readonly scenarioId?: string;
}

export interface ArmManifest {
  readonly armId: string;
  readonly stage: ArmStage;
  readonly ingress: ArmIngress;
  readonly recall: ArmRecall;
  readonly compactor: ArmCompactor;
  readonly materializer: ArmMaterializer;
  readonly configSha256: string;
}

export interface CompressionArtifact {
  readonly runId: string;
  readonly scenarioId: string;
  readonly armId: string;
  readonly outputHash: string;
  readonly sourceTraceHash: string;
  readonly boundaryLeafId: string;
  readonly visibleTokens: number;
  readonly messages: readonly unknown[];
  readonly evidenceRefs: readonly string[];
  readonly omissions: readonly Record<string, unknown>[];
}

export interface RunManifest {
  readonly runId: string;
  readonly createdAt: string;
  readonly configSha256: string;
  readonly corpusSha256: string;
  readonly piVersion: string;
  readonly piCommit: string;
  readonly nodeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly arms: readonly string[];
  readonly seeds: readonly number[];
}

export interface BenchmarkReport {
  readonly runId: string;
  readonly stage: ReportStage;
  readonly baselineArm: string;
  readonly candidateArms: readonly string[];
  readonly hardGatePass: boolean;
  readonly qualityCiLower: number;
  readonly qualityMargin: number;
  readonly medianTokenDelta: number;
  readonly realizedNetMedian: number;
  readonly failures: readonly Record<string, unknown>[];
  readonly artifactHashes: readonly string[];
}

export interface GateDecision {
  readonly runId: string;
  readonly gate: GateName;
  readonly decision: GateDecisionKind;
  readonly hardGatePass: boolean;
  readonly reasons: readonly string[];
  readonly reportSha256: string;
}

export interface BenchmarkContracts {
  readonly version: "1.0.0";
  parseRawTrace(value: unknown): RawTrace;
  parseOracle(value: unknown): Oracle;
  parseArmManifest(value: unknown): ArmManifest;
  parseCompressionArtifact(value: unknown): CompressionArtifact;
  parseRunManifest(value: unknown): RunManifest;
  parseBenchmarkReport(value: unknown): BenchmarkReport;
  parseGateDecision(value: unknown): GateDecision;
  parseBoundarySnapshot(value: unknown): BoundarySnapshot;
  canonicalJson(value: unknown): string;
  sha256Canonical(value: unknown): string;
}

interface JsonSchema {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: readonly unknown[];
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

const SHA256: JsonSchema = { type: "string", pattern: SHA256_HEX_PATTERN };

const BOUNDARY_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: BOUNDARY_REQUIRED,
  properties: {
    leafId: { type: "string", minLength: 1 },
    kind: { enum: BOUNDARY_KINDS },
    sourceTokens: { type: "integer", minimum: 0 },
  },
};

const ORACLE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ORACLE_REQUIRED,
  properties: {
    scenarioId: { type: "string", minLength: 1 },
    oracleVersion: { type: "string", minLength: 1 },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ORACLE_ITEM_REQUIRED,
        properties: {
          id: { type: "string" },
          kind: { type: "string", minLength: 1 },
          canonical: {},
          polarity: { enum: ORACLE_POLARITIES },
          status: { enum: ORACLE_STATUSES },
          sourceRefs: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
          visibility: { enum: ORACLE_VISIBILITIES },
          risk: { enum: ORACLE_RISKS },
          aliases: { type: "array", items: { type: "string" } },
          supersededBy: { type: ["string", "null"] },
        },
      },
    },
    environmentAssertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "kind"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", minLength: 1 },
        },
      },
    },
    forbiddenActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "pattern"],
        properties: {
          id: { type: "string" },
          pattern: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

const RAW_TRACE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: RAW_TRACE_REQUIRED,
  properties: {
    traceId: { type: "string", minLength: 1 },
    scenarioId: { type: "string", minLength: 1 },
    seed: { type: "integer" },
    pi: {
      type: "object",
      additionalProperties: false,
      required: ["version", "commit"],
      properties: {
        version: { type: "string", minLength: 1 },
        commit: { type: "string", minLength: 1 },
      },
    },
    rawTraceSha256: SHA256,
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["entryId", "role", "contentSha256"],
        properties: {
          entryId: { type: "string" },
          role: { type: "string", minLength: 1 },
          contentSha256: SHA256,
        },
      },
    },
    boundary: BOUNDARY_SCHEMA,
    workspaceSnapshotSha256: SHA256,
    messageDigest: { type: "string", minLength: 1 },
  },
};

const BOUNDARY_SNAPSHOT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: BOUNDARY_SNAPSHOT_REQUIRED,
  properties: {
    workspaceSnapshotSha256: SHA256,
    boundary: BOUNDARY_SCHEMA,
    snapshotId: { type: "string", minLength: 1 },
    scenarioId: { type: "string", minLength: 1 },
  },
};

const ARM_MANIFEST_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ARM_MANIFEST_REQUIRED,
  properties: {
    armId: { type: "string", minLength: 1 },
    stage: { enum: ARM_STAGES },
    ingress: { enum: ARM_INGRESS },
    recall: { enum: ARM_RECALL },
    compactor: { enum: ARM_COMPACTORS },
    materializer: { enum: ARM_MATERIALIZERS },
    configSha256: SHA256,
  },
};

const COMPRESSION_ARTIFACT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: COMPRESSION_ARTIFACT_REQUIRED,
  properties: {
    runId: { type: "string", minLength: 1 },
    scenarioId: { type: "string", minLength: 1 },
    armId: { type: "string", minLength: 1 },
    outputHash: SHA256,
    sourceTraceHash: SHA256,
    boundaryLeafId: { type: "string", minLength: 1 },
    visibleTokens: { type: "integer", minimum: 0 },
    messages: { type: "array" },
    evidenceRefs: { type: "array", items: { type: "string" } },
    omissions: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

const RUN_MANIFEST_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: RUN_MANIFEST_REQUIRED,
  properties: {
    runId: { type: "string", minLength: 1 },
    createdAt: { type: "string", minLength: 1 },
    configSha256: SHA256,
    corpusSha256: SHA256,
    piVersion: { type: "string", minLength: 1 },
    piCommit: { type: "string", minLength: 1 },
    nodeVersion: { type: "string", minLength: 1 },
    os: { type: "string", minLength: 1 },
    arch: { type: "string", minLength: 1 },
    arms: { type: "array", items: { type: "string", minLength: 1 } },
    seeds: { type: "array", items: { type: "integer" } },
  },
};

const BENCHMARK_REPORT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: BENCHMARK_REPORT_REQUIRED,
  properties: {
    runId: { type: "string", minLength: 1 },
    stage: { enum: REPORT_STAGES },
    baselineArm: { type: "string", minLength: 1 },
    candidateArms: { type: "array", items: { type: "string", minLength: 1 } },
    hardGatePass: { type: "boolean" },
    qualityCiLower: { type: "number" },
    qualityMargin: { type: "number", minimum: 0 },
    medianTokenDelta: { type: "number" },
    realizedNetMedian: { type: "number" },
    failures: { type: "array", items: { type: "object", additionalProperties: true } },
    artifactHashes: { type: "array", items: SHA256 },
  },
};

const GATE_DECISION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: GATE_DECISION_REQUIRED,
  properties: {
    runId: { type: "string", minLength: 1 },
    gate: { enum: GATE_NAMES },
    decision: { enum: GATE_DECISIONS },
    hardGatePass: { type: "boolean" },
    reasons: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    reportSha256: SHA256,
  },
};

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function fail(path: string, message: string): never {
  const prefix = path || "$";
  throw new Error(`${prefix}: ${message}`);
}

function validate(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      fail(path, `invalid enum ${JSON.stringify(value)}`);
    }
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      fail(path, `expected ${types.join("|")}, got ${typeName(value)}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(path, value.length === 0 ? "id must not be empty" : `minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      fail(path, `pattern ${schema.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(path, `minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(path, `maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      const leaf = path.split(".").pop() ?? path;
      fail(path, `${leaf} must have minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validate(item, schema.items as JsonSchema, `${path}[${i}]`));
    }
    return;
  }
  if (value !== null && typeof value === "object" && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(record, key)) {
        fail(path, `missing ${key}`);
      }
    }
    for (const key of Object.keys(record)) {
      const property = schema.properties[key];
      if (property) {
        validate(record[key], property, path ? `${path}.${key}` : key);
        continue;
      }
      if (schema.additionalProperties === false) {
        fail(path ? `${path}.${key}` : key, `unknown field ${key}`);
      }
      if (typeof schema.additionalProperties === "object") {
        validate(record[key], schema.additionalProperties, path ? `${path}.${key}` : key);
      }
    }
  }
}

function rejectEmptyOrDuplicateIds(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) {
      fail(path, "id must not be empty");
    }
    if (seen.has(id)) {
      fail(path, `duplicate id ${id}`);
    }
    seen.add(id);
  }
}

function collectIds(items: unknown, field: string): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item !== null && typeof item === "object" && field in item) {
      const value = (item as Record<string, unknown>)[field];
      return typeof value === "string" ? value : "";
    }
    return "";
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const nested of Object.values(value as object)) {
    deepFreeze(nested);
  }
  return value;
}

function canonicalize(value: unknown, path: string): unknown {
  if (value === undefined) {
    fail(path, "undefined is not allowed");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail(path, "NaN/Infinity/undefined are not allowed");
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => canonicalize(item, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => {
      const left = [...a];
      const right = [...b];
      const n = Math.min(left.length, right.length);
      for (let i = 0; i < n; i += 1) {
        const da = left[i]!.codePointAt(0) ?? 0;
        const db = right[i]!.codePointAt(0) ?? 0;
        if (da !== db) return da - db;
      }
      return left.length - right.length;
    });
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = canonicalize((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, "$"));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function parse<T>(value: unknown, schema: JsonSchema, after?: (clone: T) => void): T {
  validate(value, schema, "");
  const clone = structuredClone(value) as T;
  after?.(clone);
  return deepFreeze(clone);
}

export function defineBenchmarkContracts(): BenchmarkContracts {
  return {
    version: CONTRACT_VERSION,
    parseRawTrace(value) {
      return parse<RawTrace>(value, RAW_TRACE_SCHEMA, (trace) => {
        rejectEmptyOrDuplicateIds(collectIds(trace.entries, "entryId"), "entries");
      });
    },
    parseOracle(value) {
      return parse<Oracle>(value, ORACLE_SCHEMA, (oracle) => {
        rejectEmptyOrDuplicateIds(collectIds(oracle.items, "id"), "items");
        rejectEmptyOrDuplicateIds(collectIds(oracle.environmentAssertions, "id"), "environmentAssertions");
        rejectEmptyOrDuplicateIds(collectIds(oracle.forbiddenActions, "id"), "forbiddenActions");
      });
    },
    parseArmManifest(value) {
      return parse<ArmManifest>(value, ARM_MANIFEST_SCHEMA);
    },
    parseCompressionArtifact(value) {
      return parse<CompressionArtifact>(value, COMPRESSION_ARTIFACT_SCHEMA);
    },
    parseRunManifest(value) {
      return parse<RunManifest>(value, RUN_MANIFEST_SCHEMA);
    },
    parseBenchmarkReport(value) {
      return parse<BenchmarkReport>(value, BENCHMARK_REPORT_SCHEMA);
    },
    parseGateDecision(value) {
      return parse<GateDecision>(value, GATE_DECISION_SCHEMA);
    },
    parseBoundarySnapshot(value) {
      return parse<BoundarySnapshot>(value, BOUNDARY_SNAPSHOT_SCHEMA);
    },
    canonicalJson,
    sha256Canonical,
  };
}

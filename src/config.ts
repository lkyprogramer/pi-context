import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR, hashCanonical, type PctxConfig, type Profile, type Sha256 } from "./contracts.js";
import { resolveAgentDir } from "./pi/agent-dir.js";

export type { PctxConfig } from "./contracts.js";

export const DEFAULT_CONFIG: PctxConfig = {
  schemaVersion: 6,
  profile: "observe",
  storage: { mode: "persistent", dbPath: null, maxIndexBytes: 268435456 },
  history: { searchLimit: 8, searchMaxTokens: 1500, readMaxTokens: 3000, readMaxBytes: 32768 },
  fold: {
    triggerPercent: 60,
    targetPercent: 40,
    protectRecentBatches: 4,
    minRemovedTokens: 4096,
    minFoldableBytes: 1024,
    stubHeadChars: 120,
    stubHeadBytes: 0,
    stubTailBytes: 0,
  },
  telemetry: { includeContent: false, jsonl: false, maxLogBytes: 5242880 },
};

export interface LoadedConfig {
  config: PctxConfig;
  configHash: Sha256;
  source: string;
  warnings: string[];
}

const TOP_KEYS = new Set(["schemaVersion", "profile", "storage", "history", "fold", "telemetry"]);
const STORAGE_KEYS = new Set(["mode", "dbPath", "maxIndexBytes"]);
const HISTORY_KEYS = new Set(["searchLimit", "searchMaxTokens", "readMaxTokens", "readMaxBytes"]);
const FOLD_KEYS = new Set([
  "triggerPercent",
  "targetPercent",
  "protectRecentBatches",
  "minRemovedTokens",
  "minFoldableBytes",
  "stubHeadChars",
  "stubHeadBytes",
  "stubTailBytes",
]);
const TELEMETRY_KEYS = new Set(["includeContent", "jsonl", "maxLogBytes"]);
const LEGACY_KEYS = ["checkpoint", "semantic", "projection"];

function fail(message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = ERROR.CONFIG;
  throw err;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(raw: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) fail(`unknown config field: ${label}${key}`);
  }
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  return value;
}

function nonNegative(value: unknown, name: string): number {
  const n = finiteNumber(value, name);
  if (n < 0) fail(`${name} must not be negative`);
  return n;
}

function mergeSection<T extends object>(base: T, overlay: unknown, allowed: Set<string>, label: string): T {
  if (overlay === undefined) return { ...base };
  if (!isPlainObject(overlay)) fail(`${label} must be an object`);
  rejectUnknown(overlay, allowed, `${label}.`);
  return { ...base, ...overlay };
}

export function parseConfig(input: unknown): PctxConfig {
  if (!isPlainObject(input)) fail("config must be an object");
  for (const legacy of LEGACY_KEYS) {
    if (legacy in input) fail(`schemaVersion 6; remove ${legacy}`);
  }
  rejectUnknown(input, TOP_KEYS, "");
  if (input.schemaVersion === 5) fail("schemaVersion must be 6; v5 configs are not migrated");
  if (input.schemaVersion !== 6) fail("schemaVersion must be 6");

  const profile = (input.profile ?? DEFAULT_CONFIG.profile) as Profile | string;
  if (profile !== "off" && profile !== "observe" && profile !== "balanced") {
    fail("invalid profile");
  }

  const storage = mergeSection(DEFAULT_CONFIG.storage, input.storage, STORAGE_KEYS, "storage");
  if (storage.mode !== "persistent" && storage.mode !== "memory-only") fail("storage.mode invalid");
  if (storage.dbPath !== null && typeof storage.dbPath !== "string") fail("storage.dbPath must be string or null");
  storage.maxIndexBytes = nonNegative(storage.maxIndexBytes, "storage.maxIndexBytes");

  const history = mergeSection(DEFAULT_CONFIG.history, input.history, HISTORY_KEYS, "history");
  history.searchLimit = nonNegative(history.searchLimit, "history.searchLimit");
  history.searchMaxTokens = nonNegative(history.searchMaxTokens, "history.searchMaxTokens");
  history.readMaxTokens = nonNegative(history.readMaxTokens, "history.readMaxTokens");
  history.readMaxBytes = nonNegative(history.readMaxBytes, "history.readMaxBytes");

  const fold = mergeSection(DEFAULT_CONFIG.fold, input.fold, FOLD_KEYS, "fold");
  fold.triggerPercent = nonNegative(fold.triggerPercent, "fold.triggerPercent");
  fold.targetPercent = nonNegative(fold.targetPercent, "fold.targetPercent");
  fold.protectRecentBatches = nonNegative(fold.protectRecentBatches, "fold.protectRecentBatches");
  fold.minRemovedTokens = nonNegative(fold.minRemovedTokens, "fold.minRemovedTokens");
  fold.minFoldableBytes = nonNegative(fold.minFoldableBytes, "fold.minFoldableBytes");
  fold.stubHeadChars = nonNegative(fold.stubHeadChars, "fold.stubHeadChars");
  fold.stubHeadBytes = nonNegative(fold.stubHeadBytes, "fold.stubHeadBytes");
  fold.stubTailBytes = nonNegative(fold.stubTailBytes, "fold.stubTailBytes");
  if (fold.protectRecentBatches < 1) fail("fold.protectRecentBatches must be >= 1");
  if (fold.triggerPercent >= 85) fail("fold.triggerPercent must be < 85");
  if (fold.targetPercent >= fold.triggerPercent) fail("fold.targetPercent must be < fold.triggerPercent");

  const telemetryIn = input.telemetry;
  if (telemetryIn !== undefined && !isPlainObject(telemetryIn)) fail("telemetry must be an object");
  if (telemetryIn) rejectUnknown(telemetryIn, TELEMETRY_KEYS, "telemetry.");
  if (telemetryIn?.includeContent === true) fail("telemetry.includeContent must be false");
  const jsonl = telemetryIn?.jsonl ?? DEFAULT_CONFIG.telemetry.jsonl;
  if (typeof jsonl !== "boolean") fail("telemetry.jsonl must be boolean");
  const maxLogBytes = nonNegative(telemetryIn?.maxLogBytes ?? DEFAULT_CONFIG.telemetry.maxLogBytes, "telemetry.maxLogBytes");

  return {
    schemaVersion: 6,
    profile,
    storage,
    history,
    fold,
    telemetry: { includeContent: false, jsonl, maxLogBytes },
  };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function deepMergeConfig(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) out[key] = { ...prev, ...value };
    else out[key] = value;
  }
  return out;
}

export function loadConfig(cwd: string, projectTrusted: boolean, agentDir: string = resolveAgentDir()): LoadedConfig {
  const warnings: string[] = [];
  const globalDir = agentDir;
  const globalPath = join(globalDir, "pctx.json");
  const globalLegacy = join(globalDir, "pctx-v5.json");
  const projectPath = join(cwd, ".pi", "pctx.json");
  const projectLegacy = join(cwd, ".pi", "pctx-v5.json");

  if (existsSync(globalLegacy) || existsSync(projectLegacy)) {
    warnings.push("ignored-legacy-config");
  }

  let merged: Record<string, unknown> = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  let source = "default";

  if (existsSync(globalPath)) {
    const raw = readJson(globalPath);
    if (!isPlainObject(raw)) fail("global pctx.json must be an object");
    merged = deepMergeConfig(merged, raw);
    source = globalPath;
  }

  if (existsSync(projectPath)) {
    if (!projectTrusted) warnings.push("untrusted-project-config");
    else {
      const raw = readJson(projectPath);
      if (!isPlainObject(raw)) fail("project pctx.json must be an object");
      merged = deepMergeConfig(merged, raw);
      source = projectPath;
    }
  }

  const config = parseConfig(merged);
  return { config, configHash: hashCanonical(config), source, warnings };
}

export function configHashOf(config: PctxConfig): Sha256 {
  return hashCanonical(config);
}

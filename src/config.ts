import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ERROR, hashCanonical, type Profile, type Sha256 } from "./contracts.js";

export interface PctxConfig {
  schemaVersion: 5;
  profile: Profile;
  storage: { mode: "persistent" | "memory-only"; maxIndexBytes: number };
  history: { searchLimit: number; searchMaxTokens: number; readMaxTokens: number; readMaxBytes: number };
  projection: {
    protectRecentBatches: number;
    minEpochRequests: number;
    minRemovedTokens: number;
    minCandidateReduction: number;
  };
  checkpoint: { maxTokens: number; maxWindowFraction: number };
  semantic: {
    enabled: boolean;
    maxLogicalCallsPerCompaction: 1;
    maxRetries: number;
    maxWallMs: number;
    providerOverride: string | null;
  };
  telemetry: { includeContent: false; maxLogBytes: number };
}

export const DEFAULT_CONFIG: PctxConfig = {
  schemaVersion: 5,
  profile: "observe",
  storage: { mode: "persistent", maxIndexBytes: 268435456 },
  history: { searchLimit: 8, searchMaxTokens: 1500, readMaxTokens: 3000, readMaxBytes: 32768 },
  projection: {
    protectRecentBatches: 4,
    minEpochRequests: 8,
    minRemovedTokens: 4096,
    minCandidateReduction: 0.15,
  },
  checkpoint: { maxTokens: 1000, maxWindowFraction: 0.02 },
  semantic: {
    enabled: false,
    maxLogicalCallsPerCompaction: 1,
    maxRetries: 1,
    maxWallMs: 20000,
    providerOverride: null,
  },
  telemetry: { includeContent: false, maxLogBytes: 5242880 },
};

function fail(message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = ERROR.CONFIG;
  throw err;
}

export function parseConfig(input: unknown): PctxConfig {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("config must be an object");
  const raw = input as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "profile", "storage", "history", "projection", "checkpoint", "semantic", "telemetry"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) fail(`unknown config field: ${key}`);
  }
  if (raw.schemaVersion !== 5) fail("schemaVersion must be 5");
  const profile = raw.profile ?? "observe";
  if (profile !== "off" && profile !== "observe" && profile !== "balanced" && profile !== "experimental-semantic") {
    fail("invalid profile");
  }
  if (profile === "balanced" && raw.schemaVersion !== 5) fail("balanced requires schemaVersion 5");
  const telemetry = (raw.telemetry ?? DEFAULT_CONFIG.telemetry) as Record<string, unknown>;
  if (telemetry.includeContent === true) fail("telemetry.includeContent must be false");
  const storage = { ...DEFAULT_CONFIG.storage, ...((raw.storage as object) ?? {}) };
  const history = { ...DEFAULT_CONFIG.history, ...((raw.history as object) ?? {}) };
  const projection = { ...DEFAULT_CONFIG.projection, ...((raw.projection as object) ?? {}) };
  const checkpoint = { ...DEFAULT_CONFIG.checkpoint, ...((raw.checkpoint as object) ?? {}) };
  const semantic = { ...DEFAULT_CONFIG.semantic, ...((raw.semantic as object) ?? {}) };
  return {
    schemaVersion: 5,
    profile: profile as Profile,
    storage: storage as PctxConfig["storage"],
    history: history as PctxConfig["history"],
    projection: projection as PctxConfig["projection"],
    checkpoint: checkpoint as PctxConfig["checkpoint"],
    semantic: { ...semantic, maxLogicalCallsPerCompaction: 1, enabled: Boolean(semantic.enabled) } as PctxConfig["semantic"],
    telemetry: { includeContent: false, maxLogBytes: Number(telemetry.maxLogBytes ?? DEFAULT_CONFIG.telemetry.maxLogBytes) },
  };
}

export function loadConfig(cwd: string, projectTrusted: boolean): { config: PctxConfig; configHash: Sha256; source: string } {
  const globalPath = join(homedir(), ".pi", "agent", "pctx-v5.json");
  let merged: unknown = DEFAULT_CONFIG;
  let source = "default";
  if (existsSync(globalPath)) {
    merged = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(globalPath, "utf8")) };
    source = globalPath;
  }
  const projectPath = join(cwd, ".pi", "pctx-v5.json");
  if (projectTrusted && existsSync(projectPath)) {
    const project = JSON.parse(readFileSync(projectPath, "utf8")) as Record<string, unknown>;
    if ("telemetry" in project && (project.telemetry as { includeContent?: boolean })?.includeContent === true) {
      fail("project config cannot enable includeContent");
    }
    merged = { ...(merged as object), ...project };
    source = projectPath;
  }
  const config = parseConfig(merged);
  return { config, configHash: hashCanonical(config), source };
}

export function configHashOf(config: PctxConfig): Sha256 {
  return hashCanonical(config);
}

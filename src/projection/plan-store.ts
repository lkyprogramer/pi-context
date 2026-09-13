import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSha256, type FoldPlan } from "../contracts.js";

/**
 * Fold plans live in `<agentDir>/pctx/plans/<workspaceId>/<sessionId>.json`, not in the
 * session log: design rule 00-target §10 forbids writing anything to the canonical log,
 * and a plan is derived state that must be re-validated before it is applied again.
 * Only identity plus `{key, entryId, blockIndex, sourceHash}` per replacement is stored;
 * stub text and token numbers are recomputed from the live field on restore, so a
 * tampered or stale file can never put text into the prompt. Losing the file only
 * means one unfolded request.
 */
const PLAN_FILE_VERSION = 6;

export interface StoredReplacement {
  key: string;
  entryId: string;
  blockIndex: number;
  sourceHash: string;
}

export interface StoredPlan {
  planId: string;
  workspaceId: string;
  sessionId: string;
  compactionBoundary: string | null;
  modelId: string;
  configHash: string;
  createdAt: string;
  usagePercentAtPlan: number;
  replacements: StoredReplacement[];
}

interface PlanFile extends StoredPlan {
  v: typeof PLAN_FILE_VERSION;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "_";
}

export function planPath(agentDir: string, workspaceId: string, sessionId: string): string {
  return join(agentDir, "pctx", "plans", safeSegment(workspaceId), `${safeSegment(sessionId)}.json`);
}

export function savePlan(agentDir: string, workspaceId: string, plan: FoldPlan): void {
  const path = planPath(agentDir, workspaceId, plan.sessionId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const payload: PlanFile = {
    v: PLAN_FILE_VERSION,
    planId: plan.planId,
    workspaceId,
    sessionId: plan.sessionId,
    compactionBoundary: plan.compactionBoundary,
    modelId: plan.modelId,
    configHash: plan.configHash,
    createdAt: plan.createdAt,
    usagePercentAtPlan: plan.usagePercentAtPlan,
    replacements: [...plan.replacements.entries()].map(([key, item]) => ({
      key,
      entryId: item.entryId,
      blockIndex: item.blockIndex,
      sourceHash: item.sourceHash,
    })),
  };
  const tmp = `${path}.${process.pid}.tmp`;
  let renamed = false;
  try {
    writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    renameSync(tmp, path);
    renamed = true;
  } finally {
    if (!renamed) rmSync(tmp, { force: true });
  }
}

export function deletePlan(agentDir: string, workspaceId: string, sessionId: string): void {
  rmSync(planPath(agentDir, workspaceId, sessionId), { force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function parseReplacement(value: unknown): StoredReplacement | null {
  if (!isRecord(value)) return null;
  const { key, entryId, blockIndex, sourceHash } = value;
  if (typeof key !== "string" || typeof entryId !== "string" || !entryId) return null;
  if (typeof blockIndex !== "number" || !Number.isInteger(blockIndex) || blockIndex < 0) return null;
  if (typeof sourceHash !== "string" || !isSha256(sourceHash)) return null;
  if (key !== `${entryId}:${blockIndex}`) return null;
  return { key, entryId, blockIndex, sourceHash };
}

/**
 * Returns the stored identity + replacement locators, or null for a missing, unreadable,
 * malformed or foreign (other workspace/session) file. A malformed file is deleted so the
 * next resume does not re-read it; a missing file is simply "no plan".
 */
export function loadPlan(agentDir: string, workspaceId: string, sessionId: string): StoredPlan | null {
  const path = planPath(agentDir, workspaceId, sessionId);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parsed = parsePlanFile(text, workspaceId, sessionId);
  if (!parsed) rmSync(path, { force: true });
  return parsed;
}

function parsePlanFile(text: string, workspaceId: string, sessionId: string): StoredPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== PLAN_FILE_VERSION) return null;
  if (typeof raw.planId !== "string" || !raw.planId) return null;
  if (raw.workspaceId !== workspaceId || raw.sessionId !== sessionId) return null;
  if (raw.compactionBoundary !== null && typeof raw.compactionBoundary !== "string") return null;
  if (typeof raw.modelId !== "string" || typeof raw.configHash !== "string" || typeof raw.createdAt !== "string") return null;
  if (!isPercent(raw.usagePercentAtPlan)) return null;
  if (!Array.isArray(raw.replacements) || raw.replacements.length === 0) return null;
  const replacements: StoredReplacement[] = [];
  const seen = new Set<string>();
  for (const item of raw.replacements) {
    const rep = parseReplacement(item);
    if (!rep || seen.has(rep.key)) return null;
    seen.add(rep.key);
    replacements.push(rep);
  }
  return {
    planId: raw.planId,
    workspaceId,
    sessionId,
    compactionBoundary: raw.compactionBoundary,
    modelId: raw.modelId,
    configHash: raw.configHash,
    createdAt: raw.createdAt,
    usagePercentAtPlan: raw.usagePercentAtPlan,
    replacements,
  };
}

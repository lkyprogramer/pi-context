import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StatusView } from "../contracts.js";
import type { PluginState } from "../plugin.js";
import { resolveAgentDir } from "../pi/agent-dir.js";

export interface RequestMetrics {
  runId: string;
  epoch: number;
  profile: string;
  mappedSources: number;
  transforms: number;
  estimatedTokens: number;
  estimateMethod: string;
  firstChangedIndex: number | null;
  hookWallMs: number;
  scopeDenials: number;
  sourceMissing: number;
  exposureConfirmedCount: number;
}

export interface AssistantUsage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  totalTokens: number | null;
}

export interface AssistantRecord {
  stopReason: string | null;
  usage: AssistantUsage | null;
}

export function emptyMetrics(epoch: number, profile: string): RequestMetrics {
  return {
    runId: crypto.randomUUID(),
    epoch,
    profile,
    mappedSources: 0,
    transforms: 0,
    estimatedTokens: 0,
    estimateMethod: "character-estimate",
    firstChangedIndex: null,
    hookWallMs: 0,
    scopeDenials: 0,
    sourceMissing: 0,
    exposureConfirmedCount: 0,
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function recordAssistant(message: {
  stopReason?: string;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
  };
}): AssistantRecord {
  const usage = message.usage;
  return {
    stopReason: typeof message.stopReason === "string" ? message.stopReason : null,
    usage: usage
      ? {
          input: num(usage.input),
          output: num(usage.output),
          cacheRead: num(usage.cacheRead),
          cacheWrite: num(usage.cacheWrite),
          totalTokens: num(usage.totalTokens),
        }
      : null,
  };
}

export function statusView(state: PluginState, ctx: ExtensionContext): StatusView {
  const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  const index = state.index.status();
  const warnings = [...state.warnings, ...index.warnings];
  return {
    resolvedProfile: state.profile,
    configHash: state.configHash,
    configSource: state.configSource,
    warnings,
    hostVersion: state.hostVersion,
    contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
    contextPercent: usage?.percent ?? null,
    activePlan: state.plan
      ? {
          planId: state.plan.planId,
          replacements: state.plan.replacements.size,
          savedTokensEstimate: state.plan.savedTokensEstimate,
          entryIds: [...new Set([...state.plan.replacements.keys()].map((key) => key.slice(0, key.lastIndexOf(":"))))],
        }
      : null,
    folds: state.telemetry.folds,
    nativeCompactions: state.nativeCompactions,
    historyReads: state.historyReads,
    historySearches: state.historySearches,
    verifiedReads: state.verifiedReads,
    lastRequests: state.telemetry.lastRequests.slice(-5),
    indexMode: index.mode,
    dbPath: index.dbPath,
    indexRows: index.rows,
    indexBytes: index.bytes,
    lastIndexedLeaf: index.lastIndexedLeaf,
  };
}

export function writeStatusFile(state: PluginState, ctx?: { agentDir?: string; getContextUsage?: ExtensionContext["getContextUsage"]; model?: ExtensionContext["model"] }): void {
  const dir = resolveAgentDir(state.agentDir ?? (typeof ctx?.agentDir === "string" ? ctx.agentDir : null));
  mkdirSync(dir, { recursive: true });
  const view = statusView(state, (ctx ?? {}) as ExtensionContext);
  writeFileSync(join(dir, "pctx-status.json"), JSON.stringify(view));
}


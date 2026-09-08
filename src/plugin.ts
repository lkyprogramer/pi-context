import type { LoadedConfig, PctxConfig } from "./config.js";
import { DEFAULT_CONFIG, configHashOf, parseConfig } from "./config.js";
import type { HistoryRequest, HistoryResult, NativeEntry, Profile, Scope } from "./contracts.js";
import type { AssistantRecord } from "./telemetry/metrics.js";
import { HistoryIndex } from "./history/index.js";
import { readHistory } from "./history/read.js";
import { readBudgetFor } from "./projection/budget.js";
import { searchHistory } from "./history/search.js";
import { buildScope } from "./history/scope.js";
import type { FrozenPlan } from "./projection/planner.js";
import type { AgentMessage } from "./projection/render.js";

export interface PluginTelemetry {
  lastRequests: unknown[];
  folds: number;
}

export interface PluginState {
  config: PctxConfig;
  profile: Profile;
  index: HistoryIndex;
  scope: Scope | null;
  plan: FrozenPlan | null;
  telemetry: PluginTelemetry;
  configHash: string;
  configSource: string;
  warnings: string[];
  hostVersion: string;
  nativeCompactions: number;
  lastAssistant: AssistantRecord | null;
  historyReads: number;
  historySearches: number;
}

export function createPlugin(config: PctxConfig = DEFAULT_CONFIG): PluginState {
  return {
    config,
    profile: config.profile,
    index: HistoryIndex.open({
      mode: "memory-only",
      dbPath: null,
      maxIndexBytes: config.storage.maxIndexBytes,
    }),
    scope: null,
    plan: null,
    telemetry: { lastRequests: [], folds: 0 },
    configHash: configHashOf(config),
    configSource: "default",
    warnings: [],
    hostVersion: "unknown",
    nativeCompactions: 0,
    lastAssistant: null,
    historyReads: 0,
    historySearches: 0,
  };
}

export function applyLoadedConfig(state: PluginState, loaded: LoadedConfig): void {
  state.config = loaded.config;
  state.profile = loaded.config.profile;
  state.configHash = loaded.configHash;
  state.configSource = loaded.source;
  state.warnings = loaded.warnings;
}

export function applyConfigFailure(state: PluginState, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  state.config = { ...DEFAULT_CONFIG, profile: "observe" };
  state.profile = "observe";
  state.configHash = configHashOf(state.config);
  state.configSource = "default";
  state.warnings = [`config-error:${message}`];
}

export function setProfile(state: PluginState, profile: Profile): void {
  state.profile = profile;
  state.config = parseConfig({ ...state.config, profile });
  state.plan = null;
}

export function openSessionIndex(state: PluginState): void {
  try {
    state.index.closeSync();
  } catch {
    /* first open */
  }
  try {
    state.index = HistoryIndex.open({
      mode: state.config.storage.mode,
      dbPath: state.config.storage.dbPath,
      maxIndexBytes: state.config.storage.maxIndexBytes,
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    const message = err instanceof Error ? err.message : String(err);
    if (code === "PCTX_CONFIG") state.warnings = [...state.warnings, `config-error:${message}`];
    else state.warnings = [...state.warnings, "history: unavailable"];
    state.index = HistoryIndex.unavailable();
  }
}

export function indexBranch(state: PluginState, entries: NativeEntry[], cwd: string, sessionId: string, leafId: string | null): void {
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const scope = buildScope({ cwd, sessionId, leafId, getEntry });
  state.scope = scope;
  try {
    state.index.upsertBranchSync(scope, entries);
  } catch {
    /* unavailable index stays fail-closed */
  }
}

export function closeSessionIndex(state: PluginState): void {
  try {
    state.index.closeSync();
  } catch {
    /* ignore */
  }
  state.index = HistoryIndex.unavailable();
  state.scope = null;
}

export async function historyTool(
  state: PluginState,
  req: HistoryRequest,
  entries: NativeEntry[],
  cwd: string,
  sessionId: string,
  leafId: string | null,
  usage?: { tokens: number | null; contextWindow: number; percent: number | null } | null,
): Promise<HistoryResult> {
  if (state.profile === "off") return { code: "disabled", cursor: null, diagnostic: "plugin off" };
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const scope = buildScope({ cwd, sessionId, leafId, getEntry });
  state.scope = scope;
  try {
    state.index.upsertBranchSync(scope, entries);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "INDEX_UNAVAILABLE") return { code: "degraded", cursor: null, diagnostic: "history: unavailable" };
    throw err;
  }
  if (req.action === "search") {
    state.historySearches += 1;
    return searchHistory({
      scope,
      query: req.query,
      limit: req.limit,
      cursor: req.cursor,
      index: state.index,
      config: state.config,
      getEntry,
    });
  }
  state.historyReads += 1;
  const budget = readBudgetFor(state.config, req.maxTokens, usage ?? null);
  if ("insufficient" in budget) {
    return { ok: false, code: "insufficient-context", cursor: null, diagnostic: "INSUFFICIENT_CONTEXT" };
  }
  return readHistory({
    scope,
    ref: req.ref,
    cursor: req.cursor,
    budget,
    config: state.config,
    getEntry,
  });
}

export function applyContext(_state: PluginState, messages: AgentMessage[]): AgentMessage[] {
  return messages;
}

export function noteNativeCompact(state: PluginState): void {
  state.plan = null;
  state.nativeCompactions += 1;
}

import type { LoadedConfig, PctxConfig } from "./config.js";
import { DEFAULT_CONFIG, configHashOf, parseConfig } from "./config.js";
import type { ContextUsageLike, FoldEvent, FoldPlan, HistoryRequest, HistoryResult, NativeEntry, Profile, RequestRecord, Scope } from "./contracts.js";
import type { AssistantRecord } from "./telemetry/metrics.js";
import { HistoryIndex } from "./history/index.js";
import { SearchSnapshotStore, SEARCH_SNAPSHOT_LIMITS } from "./history/page-snapshots.js";
import { readHistory } from "./history/read.js";
import { readBudgetFor } from "./projection/budget.js";
import { searchHistory } from "./history/search.js";
import { buildScope } from "./history/scope.js";
import { buildActiveView, identityIncomplete, mappingFromView } from "./projection/active-view.js";
import { collectBatches } from "./projection/batches.js";
import { exposedEntryIds } from "./projection/exposed.js";
import { planFold, planStillValid, shouldFold } from "./projection/planner.js";
import { renderFold, type AgentMessage } from "./projection/render.js";
import { estimateTokens, sha256Hex, utf8Bytes } from "./contracts.js";
import { latestCompactionId, mapToolResults, sessionSnapshot, toolCallIdOf, type SessionReader } from "./pi/source-reader.js";
import { recordFold } from "./telemetry/usage.js";
import type { ActiveView } from "./projection/view-contracts.js";
import type { AppliedReceipt, RequestIdentity } from "./projection/view-contracts.js";
import {
  inspectOpenAICompletionsPayload,
  keysMatchingPayload,
  RequestWitnessTracker,
  viewHashOf,
} from "./projection/witness.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PluginTelemetry {
  lastRequests: RequestRecord[];
  folds: number;
  foldEvents: FoldEvent[];
}

export interface PluginState {
  config: PctxConfig;
  profile: Profile;
  index: HistoryIndex;
  scope: Scope | null;
  plan: FoldPlan | null;
  telemetry: PluginTelemetry;
  configHash: string;
  configSource: string;
  warnings: string[];
  hostVersion: string;
  nativeCompactions: number;
  lastAssistant: AssistantRecord | null;
  historyReads: number;
  historySearches: number;
  verifiedReads: number;
  sessionId: string;
  agentDir: string | null;
  modelId: string;
  lastApplied: number;
  lastContextPercent: number | null;
  ttftStartedAt: number | null;
  ttftMs: number | null;
  sawMessageUpdate: boolean;
  witness: RequestWitnessTracker;
  provider: string;
  lastWitnessRequestId: string | null;
  lastIdentity: RequestIdentity | null;
  lastFieldHashes: Map<string, string> | null;
  lastCallIds: Map<string, string> | null;
  lastReceipt: AppliedReceipt | null;
  snapshots: SearchSnapshotStore;
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
    telemetry: { lastRequests: [], folds: 0, foldEvents: [] },
    configHash: configHashOf(config),
    configSource: "default",
    warnings: [],
    hostVersion: "unknown",
    nativeCompactions: 0,
    lastAssistant: null,
    historyReads: 0,
    historySearches: 0,
    verifiedReads: 0,
    sessionId: "unknown",
    agentDir: null,
    modelId: "unknown",
    lastApplied: 0,
    lastContextPercent: null,
    ttftStartedAt: null,
    ttftMs: null,
    sawMessageUpdate: false,
    witness: new RequestWitnessTracker(),
    provider: "unknown",
    lastWitnessRequestId: null,
    lastIdentity: null,
    lastFieldHashes: null,
    lastCallIds: null,
    lastReceipt: null,
    snapshots: new SearchSnapshotStore(SEARCH_SNAPSHOT_LIMITS),
  };
}

export function applyLoadedConfig(state: PluginState, loaded: LoadedConfig): void {
  const changed = loaded.configHash !== state.configHash || loaded.config.profile !== state.profile;
  state.config = loaded.config;
  state.profile = loaded.config.profile;
  state.configHash = loaded.configHash;
  state.configSource = loaded.source;
  state.warnings = loaded.warnings;
  if (changed) fenceIdentity(state);
}

export function applyConfigFailure(state: PluginState, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  state.config = { ...DEFAULT_CONFIG, profile: "observe" };
  state.profile = "observe";
  state.configHash = configHashOf(state.config);
  state.configSource = "default";
  state.warnings = [`config-error:${message}`];
  fenceIdentity(state);
}

export function setProfile(state: PluginState, profile: Profile): void {
  state.profile = profile;
  state.config = parseConfig({ ...state.config, profile });
  state.configHash = configHashOf(state.config);
  fenceIdentity(state);
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
  if (req.action === "search") {
    try {
      state.index.upsertBranchSync(scope, entries);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "INDEX_UNAVAILABLE") return { code: "degraded", cursor: null, diagnostic: "history: unavailable" };
      throw err;
    }
    state.historySearches += 1;
    return searchHistory({
      scope,
      query: req.query,
      limit: req.limit,
      cursor: req.cursor,
      index: state.index,
      config: state.config,
      getEntry,
      snapshots: state.snapshots,
      configHash: state.configHash,
    });
  }
  try {
    state.index.upsertBranchSync(scope, entries);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code !== "INDEX_UNAVAILABLE") throw err;
  }
  state.historyReads += 1;
  const budget = readBudgetFor(state.config, req.maxTokens, usage ?? null);
  if ("insufficient" in budget) {
    return { ok: false, code: "insufficient-context", cursor: null, diagnostic: "INSUFFICIENT_CONTEXT" };
  }
  const result = readHistory({
    scope,
    ref: req.ref,
    cursor: req.cursor,
    budget,
    config: state.config,
    getEntry,
  });
  if (result.verified === true) state.verifiedReads += 1;
  return result;
}

export function applyContext(
  state: PluginState,
  messages: AgentMessage[],
  ctx: ExtensionContext,
): { messages: AgentMessage[] } | undefined {
  if (state.profile !== "balanced") return undefined;
  const usageRaw = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  const usage: ContextUsageLike | null = usageRaw || ctx.model?.contextWindow
    ? {
        tokens: usageRaw?.tokens ?? null,
        contextWindow: usageRaw?.contextWindow ?? ctx.model?.contextWindow ?? 0,
        percent: usageRaw?.percent ?? null,
      }
    : null;
  const snap = sessionSnapshot({
    cwd: ctx.cwd,
    sessionManager: ctx.sessionManager as unknown as SessionReader | undefined,
  });
  state.sessionId = snap.sessionId;
  const agentDir = (ctx as { agentDir?: string }).agentDir;
  if (typeof agentDir === "string") state.agentDir = agentDir;
  const model = ctx.model as { id?: string; provider?: string; contextWindow?: number } | undefined;
  const modelId = model?.id ?? state.modelId;
  state.modelId = modelId;
  if (typeof model?.provider === "string") state.provider = model.provider;
  indexBranch(state, snap.entries, snap.cwd, snap.sessionId, snap.leafId);
  const view = state.scope
    ? buildActiveView({ scope: state.scope, entries: snap.entries, messages })
    : null;
  const boundary = view?.compactionBoundary ?? latestCompactionId(snap.entries, snap.leafId);
  const identity = identityOf(state, boundary);
  if (state.plan && !planStillValid(state.plan, {
    sessionId: snap.sessionId,
    compactionBoundary: boundary,
    modelId,
    configHash: state.configHash,
  })) {
    state.plan = null;
  }
  const canPlan = Boolean(state.scope && view && identity && !identityIncomplete(view.diagnostics));
  if (canPlan && shouldFold(usage, state.plan, state.config.fold) && usage && state.scope && view && identity) {
    const previous = state.plan;
    const foldable = witnessedView(view, state, identity);
    const next = planFold({
      scope: state.scope,
      view: foldable,
      batches: collectBatches(view.branch),
      exposed: exposedEntryIds(view.branch),
      usage,
      previous,
      modelId,
      cfg: state.config,
      configHash: state.configHash,
    });
    if (next && next !== previous) {
      const mappingForIndex = mappingFromView(view);
      const preview = renderFold(structuredClone(messages), next, mappingForIndex);
      if (preview.applied === 0) {
        /* do not publish a no-op epoch */
      } else {
        const added = preview.appliedKeys.filter((key) => !previous?.replacements.has(key)).length;
        const first = preview.firstChangedIndex;
        recordFold(state, {
          at: new Date().toISOString(),
          sessionId: snap.sessionId,
          planId: next.planId,
          reason: "threshold",
          added,
          addedEntryIds: addedEntryIds(next, previous),
          savedTokensEstimate: previewSaved(preview.beforeHash, preview.afterHash, next, previous),
          firstChangedIndex: first,
          invalidatedTokensEstimate: invalidateEstimate(messages, first),
          percentBefore: usage.percent ?? 0,
        });
        state.plan = next;
        state.lastReceipt = {
          requestId: state.lastWitnessRequestId ?? next.planId,
          identity,
          planId: next.planId,
          appliedKeys: preview.appliedKeys,
          beforeHash: preview.beforeHash,
          afterHash: preview.afterHash,
          estimatedSavedTokens: addedSaved(next, previous),
          estimateMethod: "character-estimate",
        };
      }
    }
  }
  state.lastContextPercent = usage?.percent ?? null;
  const mapping = view ? mappingFromView(view) : mapToolResults(messages, snap.entries);
  if (!state.plan) {
    state.lastApplied = 0;
    prepareWitness(state, view, messages, identity);
    return undefined;
  }
  const out = renderFold(messages, state.plan, mapping);
  state.lastApplied = out.applied;
  if (out.applied > 0 && !state.lastReceipt) {
    state.lastReceipt = {
      requestId: state.lastWitnessRequestId ?? state.plan.planId,
      identity: identity ?? {
        workspaceId: state.scope?.workspaceId ?? "",
        sessionId: snap.sessionId,
        provider: state.provider,
        model: modelId,
        configHash: state.configHash,
        compactionBoundary: boundary,
        epoch: state.witness.currentEpoch(),
      },
      planId: state.plan.planId,
      appliedKeys: out.appliedKeys,
      beforeHash: out.beforeHash,
      afterHash: out.afterHash,
      estimatedSavedTokens: state.plan.savedTokensEstimate,
      estimateMethod: "character-estimate",
    };
  }
  prepareWitness(state, view, messages, identity);
  if (out.applied === 0) return undefined;
  return { messages: out.messages };
}

function addedSaved(next: FoldPlan, previous: FoldPlan | null): number {
  const prevKeys = new Set(previous?.replacements.keys() ?? []);
  let saved = 0;
  for (const [key, item] of next.replacements) {
    if (!prevKeys.has(key)) saved += item.savedTokensEstimate;
  }
  return saved;
}

function addedEntryIds(next: FoldPlan, previous: FoldPlan | null): string[] {
  const prevKeys = new Set(previous?.replacements.keys() ?? []);
  const ids = new Set<string>();
  for (const key of next.replacements.keys()) {
    if (prevKeys.has(key)) continue;
    ids.add(key.slice(0, key.lastIndexOf(":")));
  }
  return [...ids];
}

function firstChangedFromPlan(
  plan: FoldPlan,
  mapping: ReadonlyMap<number, { entryId: string }>,
  previous: FoldPlan | null,
): number | null {
  const prevKeys = new Set(previous?.replacements.keys() ?? []);
  let first: number | null = null;
  for (const [idx, mapped] of mapping) {
    for (const key of plan.replacements.keys()) {
      if (prevKeys.has(key)) continue;
      if (!key.startsWith(`${mapped.entryId}:`)) continue;
      first = first == null ? idx : Math.min(first, idx);
    }
  }
  return first;
}

function messageText(message: AgentMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
    .join("");
}

function invalidateEstimate(messages: AgentMessage[], first: number | null): number {
  if (first == null) return 0;
  let tokens = 0;
  for (let i = first; i < messages.length; i++) {
    tokens += estimateTokens(messageText(messages[i] ?? { role: "", content: "" }));
  }
  return tokens;
}

export function fenceIdentity(state: PluginState): void {
  state.plan = null;
  state.lastWitnessRequestId = null;
  state.lastIdentity = null;
  state.lastFieldHashes = null;
  state.lastCallIds = null;
  state.lastReceipt = null;
  state.witness.reset();
  state.snapshots.clear();
}

export function noteNativeCompact(state: PluginState, counted = true): void {
  fenceIdentity(state);
  if (counted) state.nativeCompactions += 1;
}

export function observeProviderRequest(state: PluginState, payload: unknown): void {
  const requestId = state.lastWitnessRequestId;
  const identity = state.lastIdentity;
  const hashes = state.lastFieldHashes;
  if (!requestId || !identity || !hashes) return;
  const inspected = inspectOpenAICompletionsPayload(payload);
  if (inspected.method !== "provider-payload") {
    state.witness.markUnavailable(requestId, identity);
    return;
  }
  const keys = keysMatchingPayload(hashes, inspected.tools, state.lastCallIds ?? undefined);
  if (keys.length === 0) {
    state.witness.markUnavailable(requestId, identity);
    return;
  }
  state.witness.markSent(requestId, identity, keys);
}

export function acceptAssistantWitness(
  state: PluginState,
  message: { role?: string; stopReason?: string; responseId?: unknown; id?: unknown; usage?: { input?: unknown; totalTokens?: unknown; output?: unknown } },
): boolean {
  if (message.role !== "assistant") return false;
  if (!state.lastWitnessRequestId || !state.lastIdentity) return false;
  const stop = typeof message.stopReason === "string" ? message.stopReason : "";
  return state.witness.accept(state.lastWitnessRequestId, state.lastIdentity, stop, assistantResponseId(message));
}

function assistantResponseId(message: { responseId?: unknown; id?: unknown; usage?: { input?: unknown; totalTokens?: unknown; output?: unknown } }): string {
  if (typeof message.responseId === "string" && message.responseId) return message.responseId;
  if (typeof message.id === "string" && message.id) return message.id;
  const usage = message.usage;
  if (usage && (num(usage.totalTokens) || num(usage.input) || num(usage.output))) return "usage";
  return "";
}

function num(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function identityOf(state: PluginState, boundary: string | null): RequestIdentity | null {
  if (!state.scope) return null;
  return {
    workspaceId: state.scope.workspaceId,
    sessionId: state.scope.sessionId,
    provider: state.provider,
    model: state.modelId,
    configHash: state.configHash,
    compactionBoundary: boundary,
    epoch: state.witness.currentEpoch(),
  };
}

function witnessedView(view: ActiveView, state: PluginState, identity: RequestIdentity): ActiveView {
  return {
    ...view,
    fields: view.fields.filter((field) => state.witness.has(identity, field.key, field.ref.sourceHash)),
  };
}

function originalFieldHashes(view: ActiveView, messages: AgentMessage[]): { hashes: Map<string, string>; callIds: Map<string, string> } {
  const hashes = new Map<string, string>();
  const callIds = new Map<string, string>();
  const byId = new Map(view.branch.map((entry) => [entry.id, entry]));
  for (const field of view.fields) {
    const msg = messages[field.messageIndex];
    const live = fieldTextAt(msg?.content, field.blockIndex);
    if (live !== field.rawText) continue;
    const hash = sha256Hex(utf8Bytes(live));
    if (hash !== field.ref.sourceHash) continue;
    hashes.set(field.key, hash);
    const entry = byId.get(field.ref.entryId);
    const callId = toolCallIdOf(msg) ?? toolCallIdOf(entry?.message);
    if (callId) callIds.set(field.key, callId);
  }
  return { hashes, callIds };
}

function fieldTextAt(content: unknown, blockIndex: number): string | null {
  if (typeof content === "string") return blockIndex === 0 ? content : null;
  if (!Array.isArray(content)) return null;
  const block = content[blockIndex];
  if (!block || typeof block !== "object") return null;
  const text = (block as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function prepareWitness(
  state: PluginState,
  view: ActiveView | null,
  messages: AgentMessage[],
  identity: RequestIdentity | null,
): void {
  if (!view || !identity) {
    state.lastWitnessRequestId = null;
    state.lastIdentity = null;
    state.lastFieldHashes = null;
    state.lastCallIds = null;
    return;
  }
  const { hashes, callIds } = originalFieldHashes(view, messages);
  const viewHash = viewHashOf([...hashes.entries()].map(([key, sourceHash]) => ({ key, sourceHash })));
  state.lastFieldHashes = hashes;
  state.lastCallIds = callIds;
  state.lastIdentity = identity;
  state.lastWitnessRequestId = state.witness.prepare(identity, hashes, viewHash);
}

function previewSaved(
  _beforeHash: string,
  _afterHash: string,
  next: FoldPlan,
  previous: FoldPlan | null,
): number {
  return addedSaved(next, previous);
}

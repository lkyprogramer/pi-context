import type { LoadedConfig, PctxConfig } from "./config.js";
import { DEFAULT_CONFIG, configHashOf, parseConfig } from "./config.js";
import type { HistoryRequest, HistoryResult, NativeEntry, Profile, SourceRef } from "./contracts.js";
import { hashCanonical } from "./contracts.js";
import type { AssistantRecord } from "./telemetry/metrics.js";
import { HistoryIndex } from "./history/index.js";
import { readHistory } from "./history/read.js";
import { encodeRef, isFieldRef, refForField } from "./history/refs.js";
import { searchHistory } from "./history/search.js";
import { authorize, buildScope } from "./history/scope.js";
import { collectBatches } from "./projection/batches.js";
import { ExposureLedger, outcomeFromStop } from "./projection/exposure.js";
import { planEpoch, type FrozenPlan } from "./projection/planner.js";
import { cloneMessages, deepEqual, renderMessages, type AgentMessage } from "./projection/render.js";
import { restorePins, type Pin } from "./checkpoint/pins.js";
import { buildCapsule, appendCapsuleClone } from "./checkpoint/capsule.js";
import { ack, bumpFence, commitNative, emptyProposal, onCompactFailed, restoreFromNative, type Proposal } from "./checkpoint/staging.js";
import { shouldGenerateSemantic } from "./checkpoint/semantic.js";
import { mapOutbound, readVisibleSnapshot } from "./pi/source-reader.js";

export interface PluginState {
  config: PctxConfig;
  profile: Profile;
  generation: number;
  ledger: ExposureLedger;
  index: HistoryIndex;
  plan: FrozenPlan | null;
  successfulRequests: number;
  pendingAttempt: string | null;
  lastCapsule: string | null;
  proposal: Proposal;
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
    generation: 0,
    ledger: new ExposureLedger(),
    index: HistoryIndex.open({
      mode: "memory-only",
      dbPath: null,
      maxIndexBytes: config.storage.maxIndexBytes,
    }),
    plan: null,
    successfulRequests: 0,
    pendingAttempt: null,
    lastCapsule: null,
    proposal: emptyProposal(0),
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
  state.generation += 1;
  state.ledger.invalidate(state.generation);
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
}

export async function historyTool(state: PluginState, req: HistoryRequest, entries: NativeEntry[], cwd: string, sessionId: string, leafId: string | null): Promise<HistoryResult> {
  if (state.profile === "off") return { code: "disabled", cursor: null, diagnostic: "plugin off" };
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const scope = buildScope({ cwd, sessionId, leafId, getEntry });
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
  return readHistory({
    scope,
    ref: req.ref,
    cursor: req.cursor,
    maxTokens: req.maxTokens,
    config: state.config,
    getEntry,
  });
}

export function applyContext(state: PluginState, messages: AgentMessage[], entries: NativeEntry[], sessionId: string, leafId: string | null, cwd: string): AgentMessage[] {
  const started = Date.now();
  if (state.profile === "off" || state.profile === "observe") {
    return messages;
  }
  try {
    const getEntry = (id: string) => entries.find((e) => e.id === id) ?? readVisibleSnapshot({
      getSessionId: () => sessionId,
      getLeafId: () => leafId,
      getEntry: (x) => entries.find((e) => e.id === x),
    }).find((e) => e.id === id);
    const scope = buildScope({ cwd, sessionId, leafId, getEntry: (id) => getEntry(id) });
    const refs = new Map<string, SourceRef>();
    const hashes = new Map<string, string>();
    for (const entry of entries) {
      if (!authorize(scope, entry.id)) continue;
      const blockCount = Array.isArray(entry.message?.content)
        ? entry.message.content.length
        : typeof entry.message?.content === "string"
          ? 1
          : 0;
      for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
        const field = refForField(scope, entry, blockIndex);
        if (!isFieldRef(field) || field.kind !== "text") continue;
        hashes.set(entry.id, field.sourceHash);
        refs.set(entry.id, encodeRef(field));
        break;
      }
    }
    const mapped = mapOutbound(messages, entries);
    const includedOriginalRefs: SourceRef[] = [];
    for (const entry of mapped.values()) {
      const ref = refs.get(entry.id);
      if (ref) includedOriginalRefs.push(ref);
    }
    const batches = collectBatches(entries, (id) => {
      const ref = refs.get(id);
      return ref ? state.ledger.isExposed(ref, state.generation) : false;
    });
    const snapshot = {
      generation: state.generation,
      sessionId,
      leafId,
      sourceRevision: hashCanonical(entries.map((e) => e.id)),
      modelIdentity: "host",
      configHash: hashCanonical(state.config),
    };
    state.plan = planEpoch({
      entries,
      batches,
      ledger: state.ledger,
      generation: state.generation,
      snapshot,
      config: state.config,
      refs,
      hashes,
      successfulRequests: state.successfulRequests,
    });
    const attemptId = crypto.randomUUID();
    state.pendingAttempt = attemptId;
    state.ledger.begin({
      attemptId,
      snapshot,
      includedOriginalRefs,
      startedAtMs: started,
    });
    const rendered = renderMessages({
      messages,
      plan: state.plan,
      profile: state.profile,
      optionalBudget: 1000,
      mappedEntries: mapped,
      generation: state.generation,
    });
    if (rendered.bypassed) return messages;
    let outbound = rendered.messages;
    if (state.lastCapsule && outbound.length) {
      if (outbound === messages) outbound = cloneMessages(messages);
      const last = outbound[outbound.length - 1]!;
      const capsule = buildCapsule({
        snapshot,
        nativeCompactionEntryId: "native",
        pins: restorePins(entries, scope.visibleEntryIds),
        unexposedRefs: includedOriginalRefs.filter((r) => !state.ledger.isExposed(r, state.generation)),
        config: state.config,
        windowTokens: 128000,
      });
      if (typeof last.content === "string" && last.role === "user") {
        last.content = appendCapsuleClone(last.content, capsule);
      } else if (Array.isArray(last.content) && last.role === "user") {
        last.content = [...last.content, { type: "text", text: capsule.text }];
      }
    }
    return outbound;
  } catch {
    return messages;
  }
}

export function confirmAttempt(state: PluginState, stopReason?: string, errorMessage?: string, streamOutcome?: string): void {
  if (!state.pendingAttempt) return;
  const outcome = outcomeFromStop(stopReason, errorMessage, streamOutcome);
  if (outcome === "fail") state.ledger.fail(state.pendingAttempt);
  else {
    state.ledger.confirm(state.pendingAttempt, {
      generation: state.generation,
      sessionId: "s",
      leafId: null,
      sourceRevision: "0".repeat(64),
      modelIdentity: "host",
      configHash: "0".repeat(64),
    }, outcome);
    state.successfulRequests += 1;
  }
  state.pendingAttempt = null;
}

export function noteNativeCompact(state: PluginState, summary: string, entryId: string, entries: NativeEntry[], sessionId: string, leafId: string | null, cwd: string): void {
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const scope = buildScope({ cwd, sessionId, leafId, getEntry });
  const pins: Pin[] = restorePins(entries, scope.visibleEntryIds);
  const capsule = buildCapsule({
    snapshot: {
      generation: state.generation,
      sessionId,
      leafId,
      sourceRevision: hashCanonical(entries.map((e) => e.id)),
      modelIdentity: "host",
      configHash: hashCanonical(state.config),
    },
    nativeCompactionEntryId: entryId,
    pins,
    unexposedRefs: [],
    config: state.config,
    windowTokens: 128000,
  });
  state.lastCapsule = appendCapsuleClone(summary, capsule);
  state.plan = null;
  const compactHash = hashCanonical(summary);
  const gen = state.proposal.generation;
  if (state.proposal.status === "proposed") {
    state.proposal = ack(state.proposal, { hash: compactHash, generation: gen });
  }
  if (state.proposal.status === "acked") {
    state.proposal = commitNative(state.proposal, { generation: gen, nativeEntryId: entryId, nativeHash: compactHash });
  } else if (state.proposal.status === "idle") {
    state.proposal = restoreFromNative({ generation: state.generation, nativeEntryId: entryId, nativeHash: compactHash });
  }
  state.generation += 1;
}

export function restoreStagingFromEntries(state: PluginState, entries: NativeEntry[]): void {
  const compact = [...entries].reverse().find((e) => e.type === "compaction" || typeof (e as { summary?: string }).summary === "string");
  if (!compact) return;
  const summary = String((compact as { summary?: string }).summary ?? "");
  if (!summary) return;
  state.proposal = restoreFromNative({
    generation: state.generation,
    nativeEntryId: compact.id,
    nativeHash: hashCanonical(summary),
  });
}

export function noteSemanticAttempt(state: PluginState, hash: string): void {
  if (!shouldGenerateSemantic(state.profile, false)) return;
  state.proposal = { generation: state.generation, proposedHash: hash, nativeEntryId: null, ackCount: 0, status: "proposed" };
}

export function noteCompactFailed(state: PluginState): void {
  state.proposal = onCompactFailed(state.proposal);
  state.plan = null;
}

export function noteFence(state: PluginState): void {
  state.proposal = bumpFence(state.proposal);
  state.generation = state.proposal.generation;
  state.plan = null;
}

export { deepEqual };

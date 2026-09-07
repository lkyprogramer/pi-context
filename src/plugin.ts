import type { PctxConfig } from "./config.js";
import { DEFAULT_CONFIG, parseConfig } from "./config.js";
import type { HistoryRequest, HistoryResult, NativeEntry, Profile, SourceRef } from "./contracts.js";
import { hashCanonical } from "./contracts.js";
import { HistoryIndex } from "./history/index.js";
import { readHistory } from "./history/read.js";
import { encodeRef } from "./history/refs.js";
import { searchHistory } from "./history/search.js";
import { authorize, buildScope } from "./history/scope.js";
import { collectBatches } from "./projection/batches.js";
import { ExposureLedger, outcomeFromStop } from "./projection/exposure.js";
import { planEpoch, type FrozenPlan } from "./projection/planner.js";
import { cloneMessages, deepEqual, renderMessages, type AgentMessage } from "./projection/render.js";
import { restorePins, type Pin } from "./checkpoint/pins.js";
import { buildCapsule, appendCapsuleClone } from "./checkpoint/capsule.js";
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
}

export function createPlugin(config: PctxConfig = DEFAULT_CONFIG): PluginState {
  return {
    config,
    profile: config.profile,
    generation: 0,
    ledger: new ExposureLedger(),
    index: new HistoryIndex(config.storage.mode),
    plan: null,
    successfulRequests: 0,
    pendingAttempt: null,
    lastCapsule: null,
  };
}

export function setProfile(state: PluginState, profile: Profile): void {
  if (profile === "balanced" && state.config.schemaVersion !== 5) {
    throw new Error("balanced requires schemaVersion 5");
  }
  state.profile = profile;
  state.config = parseConfig({ ...state.config, profile });
  state.generation += 1;
  state.ledger.invalidate(state.generation);
  state.plan = null;
}

export function historyTool(state: PluginState, req: HistoryRequest, entries: NativeEntry[], cwd: string, sessionId: string, leafId: string | null): HistoryResult {
  if (state.profile === "off") return { code: "disabled", cursor: null, diagnostic: "plugin off" };
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const scope = buildScope({ cwd, sessionId, leafId, getEntry });
  for (const e of entries) state.index.upsert(scope, e);
  if (req.action === "search") {
    return searchHistory({
      scope,
      query: req.query,
      limit: req.limit,
      cursor: req.cursor,
      index: state.index,
      config: state.config,
      sourceRevision: state.index.sourceRevision(entries),
      getText: (id) => {
        const e = getEntry(id);
        const c = e?.message?.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
        return undefined;
      },
    });
  }
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
      const text = Array.isArray(entry.message?.content)
        ? entry.message!.content!.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n")
        : "";
      if (!text) continue;
      const hash = textSourceHashSafe(text);
      hashes.set(entry.id, hash);
      refs.set(entry.id, encodeRef({
        version: 5,
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        entryId: entry.id,
        field: { kind: "text", blockIndex: 0 },
        sourceHash: hash,
      }));
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
      optionalBudget: state.config.checkpoint.maxTokens,
      mappedEntries: mapped,
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

function textSourceHashSafe(text: string): string {
  return hashCanonical(text);
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
  state.generation += 1;
}

export { deepEqual };

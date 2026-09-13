import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../../src/config.js";
import { applyContext, createPlugin, markColdFold, noteNativeCompact } from "../../src/plugin.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { collectBatches } from "../../src/projection/batches.js";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import {
  COMPACTION_OBSERVE_PERCENT,
  FOLD_CADENCE_HORIZON,
  foldCadenceOk,
  planColdFold,
  planFold,
} from "../../src/projection/planner.js";
import type { AgentMessage } from "../../src/projection/render.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";
import { call, done, result, user } from "../helpers/context-audit-fixture.js";

function expose(entry: ReturnType<typeof assistantEntry>) {
  entry.message!.usage = { input: 100, totalTokens: 100 };
  return entry;
}

function foldCfg() {
  return {
    ...DEFAULT_CONFIG,
    fold: { ...DEFAULT_CONFIG.fold, protectRecentBatches: 1, minRemovedTokens: 4096, minFoldableBytes: 1024 },
  };
}

function fourBatchEntries() {
  const big = "x".repeat(20_000);
  return [
    userEntry("u", null, textBlocks("q")),
    assistantEntry("a1", "u", [{ type: "toolCall", id: "c1" }], "toolUse"),
    toolResultEntry("r1", "a1", "c1", textBlocks(big)),
    expose(assistantEntry("d1", "r1", textBlocks("ok"))),
    assistantEntry("a2", "d1", [{ type: "toolCall", id: "c2" }], "toolUse"),
    toolResultEntry("r2", "a2", "c2", textBlocks(big)),
    expose(assistantEntry("d2", "r2", textBlocks("ok"))),
    assistantEntry("a3", "d2", [{ type: "toolCall", id: "c3" }], "toolUse"),
    toolResultEntry("r3", "a3", "c3", textBlocks(big)),
    expose(assistantEntry("d3", "r3", textBlocks("ok"))),
    assistantEntry("a4", "d3", [{ type: "toolCall", id: "c4" }], "toolUse"),
    toolResultEntry("r4", "a4", "c4", textBlocks(big)),
    expose(assistantEntry("d4", "r4", textBlocks("ok"))),
  ];
}

describe("planColdFold", () => {
  it("ignores the 60% trigger and plans to ≤40% from unfolded tokens", () => {
    const entries = fourBatchEntries();
    const window = 20_000;
    const tokens = 14_000;
    const plan = planColdFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "d4", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: exposedEntryIds(entries),
      tokens,
      contextWindow: window,
      previous: null,
      modelId: "m",
      cfg: foldCfg(),
      configHash: "h",
    });
    expect(plan).not.toBeNull();
    expect(tokens - plan!.savedTokensEstimate).toBeLessThanOrEqual((window * 40) / 100);
    expect(
      planFold({
        scope: { workspaceId: "w", sessionId: "s", leafId: "d4", visibleEntryIds: new Set(entries.map((e) => e.id)) },
        entries,
        batches: collectBatches(entries),
        exposed: exposedEntryIds(entries),
        usage: { tokens: 6000, contextWindow: window, percent: 30 },
        previous: null,
        modelId: "m",
        cfg: foldCfg(),
        configHash: "h",
      }),
    ).toBeNull();
  });

  it("does not fold a 45% warm seed (saved would be below minRemoved)", () => {
    const entries = fourBatchEntries();
    expect(
      planColdFold({
        scope: { workspaceId: "w", sessionId: "s", leafId: "d4", visibleEntryIds: new Set(entries.map((e) => e.id)) },
        entries,
        batches: collectBatches(entries),
        exposed: exposedEntryIds(entries),
        tokens: 29_500,
        contextWindow: 65_536,
        previous: null,
        modelId: "m",
        cfg: foldCfg(),
        configHash: "h",
      }),
    ).toBeNull();
  });
});

describe("foldCadenceOk", () => {
  const fold = foldCfg().fold;
  const plan = {
    planId: "p",
    sessionId: "s",
    compactionBoundary: null,
    modelId: "m",
    configHash: "h",
    createdAt: "t",
    usagePercentAtPlan: 65,
    replacements: new Map(),
    savedTokensEstimate: 8000,
  };

  it("allows the first fold of an epoch", () => {
    expect(foldCadenceOk({
      plan: null,
      usage: { tokens: 14_000, contextWindow: 20_000, percent: 70 },
      lastFoldUsageTokens: null,
      increments: [2000],
      fold,
    })).toBe(true);
  });

  it("defers incremental folds while compaction is more than the horizon away", () => {
    const window = 20_000;
    const afterFold = 8000;
    const grown = afterFold + fold.minRemovedTokens;
    const compactAt = (window * COMPACTION_OBSERVE_PERCENT) / 100;
    const avg = 1000;
    expect((compactAt - grown) / avg).toBeGreaterThan(FOLD_CADENCE_HORIZON);
    expect(foldCadenceOk({
      plan,
      usage: { tokens: grown, contextWindow: window, percent: (grown / window) * 100 },
      lastFoldUsageTokens: afterFold,
      increments: [avg, avg, avg],
      fold,
    })).toBe(false);
  });

  it("allows one more fold when compaction is within the horizon", () => {
    const window = 20_000;
    const compactAt = (window * COMPACTION_OBSERVE_PERCENT) / 100;
    const avg = 2000;
    const tokens = compactAt - avg;
    expect(foldCadenceOk({
      plan,
      usage: { tokens, contextWindow: window, percent: (tokens / window) * 100 },
      lastFoldUsageTokens: tokens - fold.minRemovedTokens,
      increments: [avg, avg],
      fold,
    })).toBe(true);
  });
});

function sixBatchMessages() {
  const entries = [user("u", null)];
  let parent = "u";
  const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "question" }] }];
  for (let i = 1; i <= 6; i++) {
    entries.push(call(`c${i}`, parent, `call${i}`), result(`r${i}`, `c${i}`, `call${i}`, "z".repeat(8000)), done(`d${i}`, `r${i}`));
    parent = `d${i}`;
    messages.push(
      { role: "assistant", content: [{ type: "toolCall", id: `call${i}`, name: "read" }] },
      { role: "toolResult", toolCallId: `call${i}`, content: [{ type: "text", text: "z".repeat(8000) }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    );
  }
  return { entries, messages, leaf: parent };
}

describe("cold path in applyContext", () => {
  it("folds the first request after a cold flag even when last-assistant usage is 30%", () => {
    const { entries, messages, leaf } = sixBatchMessages();
    const cfg = parseConfig({
      schemaVersion: 6,
      profile: "balanced",
      storage: { mode: "memory-only" },
      fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
    });
    const state = createPlugin(cfg);
    markColdFold(state);
    const out = applyContext(state, structuredClone(messages), {
      cwd: process.cwd(),
      model: { id: "wire", provider: "controlled", contextWindow: 10_000 },
      getContextUsage: () => ({ tokens: 3000, contextWindow: 10_000, percent: 30 }),
      sessionManager: {
        getEntries: () => entries,
        getSessionId: () => "s",
        getLeafId: () => leaf,
        getEntry: (id: string) => entries.find((e) => e.id === id),
      },
    } as never);
    expect(out).toBeDefined();
    expect(state.lastApplied).toBeGreaterThan(0);
    expect(state.telemetry.foldEvents.at(-1)?.reason).toBe("cold");
    state.index.closeSync();
  });

  it("rebuilds a plan via the cold path after native compaction", () => {
    const { entries, messages, leaf } = sixBatchMessages();
    const cfg = parseConfig({
      schemaVersion: 6,
      profile: "balanced",
      storage: { mode: "memory-only" },
      fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
    });
    const state = createPlugin(cfg);
    const ctx = {
      cwd: process.cwd(),
      model: { id: "wire", provider: "controlled", contextWindow: 10_000 },
      getContextUsage: () => ({ tokens: 8000, contextWindow: 10_000, percent: 80 }),
      sessionManager: {
        getEntries: () => entries,
        getSessionId: () => "s",
        getLeafId: () => leaf,
        getEntry: (id: string) => entries.find((e) => e.id === id),
      },
    };
    expect(applyContext(state, structuredClone(messages), ctx as never)).toBeDefined();
    expect(state.telemetry.foldEvents.at(-1)?.reason).toBe("threshold");
    noteNativeCompact(state);
    markColdFold(state);
    expect(state.plan).toBeNull();
    const rebuilt = applyContext(state, structuredClone(messages), {
      ...ctx,
      getContextUsage: () => ({ tokens: 3000, contextWindow: 10_000, percent: 30 }),
    } as never);
    expect(rebuilt).toBeDefined();
    expect(state.lastApplied).toBeGreaterThan(0);
    expect(state.telemetry.foldEvents.at(-1)?.reason).toBe("cold");
    state.index.closeSync();
  });

  it("records deferred-warm-fold instead of a second increment far from compaction", () => {
    const { entries, messages, leaf } = sixBatchMessages();
    const cfg = parseConfig({
      schemaVersion: 6,
      profile: "balanced",
      storage: { mode: "memory-only" },
      fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
    });
    const state = createPlugin(cfg);
    const ctx = {
      cwd: process.cwd(),
      model: { id: "wire", provider: "controlled", contextWindow: 100_000 },
      getContextUsage: () => ({ tokens: 65_000, contextWindow: 100_000, percent: 65 }),
      sessionManager: {
        getEntries: () => entries,
        getSessionId: () => "s",
        getLeafId: () => leaf,
        getEntry: (id: string) => entries.find((e) => e.id === id),
      },
    };
    expect(applyContext(state, structuredClone(messages), ctx as never)).toBeDefined();
    expect(state.telemetry.folds).toBe(1);
    state.lastFoldUsageTokens = 40_000;
    state.recentTokenIncrements = [2000, 2000, 2000];
    applyContext(state, structuredClone(messages), {
      ...ctx,
      getContextUsage: () => ({ tokens: 72_000, contextWindow: 100_000, percent: 72 }),
    } as never);
    expect(state.telemetry.folds).toBe(1);
    expect(state.telemetry.deferredWarmFolds).toBe(1);
    state.index.closeSync();
  });
});

describe("adapter cold flags", () => {
  it("marks resume/fork/compact/model_select and not a new session", () => {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const pi: PiExtensionAPI = {
      on(event, handler) {
        handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
      },
      registerTool() {},
      registerCommand() {},
    };
    const state = bindHooks(pi, createPlugin());
    const ctx = {
      cwd: process.cwd(),
      ui: { notify() {} },
      isProjectTrusted: () => true,
      model: { id: "wire", provider: "controlled", contextWindow: 10_000 },
      sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntries: () => [] },
    };
    handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx);
    expect(state.coldFoldPending).toBe(false);
    handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx);
    expect(state.coldFoldPending).toBe(true);
    handlers.get("before_provider_request")!({ payload: {} }, ctx);
    expect(state.coldFoldPending).toBe(false);
    handlers.get("session_compact")!({ type: "session_compact", willRetry: false }, ctx);
    expect(state.coldFoldPending).toBe(true);
    handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
    expect(state.coldFoldPending).toBe(false);
    handlers.get("model_select")!({ model: { id: "other", provider: "controlled" } }, ctx);
    expect(state.coldFoldPending).toBe(true);
    state.index.closeSync();
  });
});

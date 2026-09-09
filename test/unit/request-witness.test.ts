import { expect, test } from "vitest";
import { configHashOf, DEFAULT_CONFIG, parseConfig } from "../../src/config.js";
import { acceptAssistantWitness, applyContext, createPlugin, observeProviderRequest, setProfile } from "../../src/plugin.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { RequestWitnessTracker } from "../../src/projection/witness.js";
import { archivedFixture, call, done, result, user } from "../helpers/context-audit-fixture.js";
import type { AgentMessage } from "../../src/projection/render.js";
import type { NativeEntry } from "../../src/contracts.js";

test("another session cannot confirm an original", () => {
  const id = { workspaceId:"w",sessionId:"s",provider:"p",model:"m",
    configHash:"c",compactionBoundary:null,epoch:1 };
  const tracker = new RequestWitnessTracker();
  const requestId = tracker.prepare(id, new Map([["r:0","hash"]]), "view");
  tracker.markSent(requestId, id, ["r:0"]);
  expect(tracker.accept(requestId,{...id,sessionId:"other"},"stop","resp-1")).toBe(false);
  expect(tracker.has(id,"r:0","hash")).toBe(false);
  expect(tracker.accept(requestId,id,"stop","resp-1")).toBe(true);
  expect(tracker.has(id,"r:0","hash")).toBe(true);
});

test("failed assistant does not block the next serial request", () => {
  const id = { workspaceId: "w", sessionId: "s", provider: "p", model: "m", configHash: "c", compactionBoundary: null, epoch: 0 };
  const tracker = new RequestWitnessTracker();
  const first = tracker.prepare(id, new Map([["r:0", "h"]]), "v");
  expect(tracker.markSent(first, id, ["r:0"])).toBe(true);
  expect(tracker.accept(first, id, "error", "resp")).toBe(false);
  const second = tracker.prepare(id, new Map([["r:0", "h"]]), "v");
  expect(tracker.markSent(second, id, ["r:0"])).toBe(true);
  expect(tracker.accept(second, id, "stop", "resp-2")).toBe(true);
  expect(tracker.has(id, "r:0", "h")).toBe(true);
});

test("error aborted length and missing send do not confirm", () => {
  const id = { workspaceId: "w", sessionId: "s", provider: "p", model: "m", configHash: "c", compactionBoundary: null, epoch: 0 };
  const tracker = new RequestWitnessTracker();
  const a = tracker.prepare(id, new Map([["r:0", "h"]]), "v");
  expect(tracker.accept(a, id, "stop", "resp")).toBe(false);
  tracker.markSent(a, id, ["r:0"]);
  expect(tracker.accept(a, id, "error", "resp")).toBe(false);
  expect(tracker.accept(a, id, "aborted", "resp")).toBe(false);
  expect(tracker.accept(a, id, "length", "resp")).toBe(false);
  expect(tracker.has(id, "r:0", "h")).toBe(false);
  expect(tracker.accept(a, id, "stop", "resp")).toBe(true);
  expect(tracker.accept(a, id, "stop", "resp")).toBe(false);
});

test("reset increments epoch and forgets confirmations", () => {
  const id = { workspaceId: "w", sessionId: "s", provider: "p", model: "m", configHash: "c", compactionBoundary: null, epoch: 0 };
  const tracker = new RequestWitnessTracker();
  expect(tracker.currentEpoch()).toBe(0);
  const requestId = tracker.prepare(id, new Map([["r:0", "h"]]), "v");
  tracker.markSent(requestId, id, ["r:0"]);
  expect(tracker.accept(requestId, id, "stop", "resp")).toBe(true);
  tracker.reset();
  expect(tracker.currentEpoch()).toBe(1);
  expect(tracker.has(id, "r:0", "h")).toBe(false);
  tracker.reset();
  expect(tracker.currentEpoch()).toBe(2);
});

test("setProfile recomputes configHash and fences pending", () => {
  const state = createPlugin(parseConfig({ schemaVersion: 6, profile: "balanced" }));
  const before = state.configHash;
  const id = {
    workspaceId: "w",
    sessionId: "s",
    provider: "p",
    model: "m",
    configHash: before,
    compactionBoundary: null,
    epoch: state.witness.currentEpoch(),
  };
  const requestId = state.witness.prepare(id, new Map([["r:0", "h"]]), "v");
  state.witness.markSent(requestId, id, ["r:0"]);
  state.witness.accept(requestId, id, "stop", "resp");
  setProfile(state, "observe");
  const recomputed = configHashOf(state.config);
  expect(state.configHash).toBe(recomputed);
  expect(state.configHash).not.toBe(before);
  expect(state.witness.has(id, "r:0", "h")).toBe(false);
});

test("P01 applied-zero path does not record a fold", () => {
  const f = archivedFixture();
  const state = createPlugin(parseConfig({ schemaVersion: 6, profile: "balanced", storage: { mode: "memory-only" } }));
  applyContext(state, f.messages as AgentMessage[], {
    cwd: process.cwd(),
    model: { id: "model", provider: "controlled", contextWindow: 32000 },
    getContextUsage: () => ({ tokens: 22000, contextWindow: 32000, percent: 68.75 }),
    sessionManager: {
      getEntries: () => f.entries,
      getSessionId: () => "s",
      getLeafId: () => f.leaf,
      getEntry: (id: string) => f.entries.find((e) => e.id === id),
    },
  } as never);
  expect(state.telemetry.folds).toBe(0);
  expect(state.lastApplied).toBe(0);
  expect(state.lastReceipt).toBeNull();
  state.index.closeSync();
});

test("official session header omitted from getEntries is not missing-parent", () => {
  const header: NativeEntry = { id: "sess", parentId: null, type: "session" };
  const listed: NativeEntry[] = [user("u", "sess")];
  let parent = "u";
  const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "question" }] }];
  for (let i = 1; i <= 6; i++) {
    listed.push(call(`c${i}`, parent, `call${i}`), result(`r${i}`, `c${i}`, `call${i}`, "z".repeat(8000)), done(`d${i}`, `r${i}`));
    parent = `d${i}`;
    messages.push(
      { role: "assistant", content: [{ type: "toolCall", id: `call${i}`, name: "read" }] },
      { role: "toolResult", toolCallId: `call${i}`, content: [{ type: "text", text: "z".repeat(8000) }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    );
  }
  const all = [header, ...listed];
  const cfg = parseConfig({
    schemaVersion: 6,
    profile: "balanced",
    storage: { mode: "memory-only" },
    fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
  });
  const state = createPlugin(cfg);
  const ctx = {
    cwd: process.cwd(),
    model: { id: "wire", provider: "controlled", contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 8000, contextWindow: 10000, percent: 80 }),
    sessionManager: {
      getEntries: () => listed,
      getSessionId: () => "s",
      getLeafId: () => parent,
      getEntry: (id: string) => all.find((e) => e.id === id),
    },
  };
  expect(applyContext(state, structuredClone(messages), ctx as never)).toBeUndefined();
  expect(state.lastFieldHashes?.size, "session header must not empty the active view").toBeGreaterThan(0);
  observeProviderRequest(state, {
    messages: messages
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ role: "tool", content: "z".repeat(8000), tool_call_id: m.toolCallId })),
  });
  expect(acceptAssistantWitness(state, { role: "assistant", stopReason: "stop", usage: { input: 10, totalTokens: 12 } })).toBe(true);
  const out = applyContext(state, structuredClone(messages), ctx as never);
  expect(out).toBeDefined();
  expect(state.lastApplied).toBeGreaterThan(0);
  state.index.closeSync();
});

test("confirmed originals fold on the next applyContext", () => {
  const entries: NativeEntry[] = [user("u", null)];
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
  const cfg = parseConfig({
    schemaVersion: 6,
    profile: "balanced",
    storage: { mode: "memory-only" },
    fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
  });
  const state = createPlugin(cfg);
  const ctx = {
    cwd: process.cwd(),
    model: { id: "wire", provider: "controlled", contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 8000, contextWindow: 10000, percent: 80 }),
    sessionManager: {
      getEntries: () => entries,
      getSessionId: () => "s",
      getLeafId: () => parent,
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
  };
  const first = structuredClone(messages);
  expect(applyContext(state, first, ctx as never)).toBeUndefined();
  expect(JSON.stringify(first)).not.toContain("pctx folded tool result");
  expect(state.lastWitnessRequestId, `fields=${state.lastFieldHashes?.size}`).toBeTruthy();
  expect(state.lastFieldHashes?.size).toBeGreaterThan(0);
  observeProviderRequest(state, {
    messages: first
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ role: "tool", content: "z".repeat(8000), tool_call_id: m.toolCallId })),
  });
  expect(acceptAssistantWitness(state, { role: "assistant", stopReason: "stop", usage: { input: 10, totalTokens: 12 } })).toBe(true);
  const second = structuredClone(messages);
  const out = applyContext(state, second, ctx as never);
  expect(out).toBeDefined();
  expect(state.lastApplied).toBeGreaterThan(0);
  expect(JSON.stringify(out?.messages)).toContain("pctx folded tool result");
  state.index.closeSync();
});

test("bindHooks ignores user message_end and fences compact including willRetry", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi: PiExtensionAPI = {
    on(event, handler) {
      handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
    },
    registerTool() {},
    registerCommand() {},
  };
  const state = bindHooks(pi, createPlugin(parseConfig({ schemaVersion: 6, profile: "balanced" })));
  const ctx = {
    cwd: process.cwd(),
    ui: { notify() {} },
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntries: () => [] },
    model: { id: "m", provider: "p" },
  };
  handlers.get("session_start")?.({}, ctx);
  const id = state.lastIdentity ?? {
    workspaceId: "w",
    sessionId: "s",
    provider: "p",
    model: "m",
    configHash: state.configHash,
    compactionBoundary: null,
    epoch: state.witness.currentEpoch(),
  };
  const requestId = state.witness.prepare(id, new Map([["r:0", "h"]]), "v");
  state.witness.markSent(requestId, id, ["r:0"]);
  state.lastWitnessRequestId = requestId;
  state.lastIdentity = id;
  handlers.get("message_end")?.({ message: { role: "user", stopReason: "stop", usage: { input: 1 } } }, ctx);
  expect(state.witness.has(id, "r:0", "h")).toBe(false);
  handlers.get("message_end")?.({ message: { role: "assistant", stopReason: "stop", usage: { input: 1, totalTokens: 1 } } }, ctx);
  expect(state.witness.has(id, "r:0", "h")).toBe(true);
  state.plan = { planId: "x", sessionId: "s", compactionBoundary: null, modelId: "m", configHash: "h", createdAt: "t", usagePercentAtPlan: 70, replacements: new Map(), savedTokensEstimate: 0 };
  handlers.get("session_compact")?.(
    { type: "session_compact", compactionEntry: { id: "c1" }, willRetry: true, reason: "overflow", fromExtension: false },
    ctx,
  );
  expect(state.nativeCompactions).toBe(0);
  expect(state.plan).toBeNull();
  expect(state.witness.has(id, "r:0", "h")).toBe(false);
  state.index.closeSync();
});

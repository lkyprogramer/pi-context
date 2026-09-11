import { expect, test } from "vitest";
import { configHashOf, parseConfig } from "../../src/config.js";
import { applyContext, createPlugin, lastSuccessfulAssistantUsage, resolveContextUsage, setProfile } from "../../src/plugin.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { RequestWitnessTracker } from "../../src/projection/witness.js";
import { archivedFixture, call, done, result, user } from "../helpers/context-audit-fixture.js";
import type { AgentMessage } from "../../src/projection/render.js";
import { sha256Hex, type NativeEntry } from "../../src/contracts.js";

test("session-log fields confirm without a provider round-trip", () => {
  const id = { workspaceId: "w", sessionId: "s", provider: "p", model: "m", configHash: "c", compactionBoundary: null, epoch: 0 };
  const tracker = new RequestWitnessTracker();
  tracker.confirmPersisted(id, "r:0", "hash");
  expect(tracker.has(id, "r:0", "hash")).toBe(true);
  expect(tracker.has({ ...id, epoch: 1 }, "r:0", "hash")).toBe(false);
});

test("null host usage falls back to the last successful session assistant", () => {
  const entries: NativeEntry[] = [
    user("u", null),
    { id: "a", parentId: "u", type: "message", message: { role: "assistant", stopReason: "stop", usage: { input: 6500, totalTokens: 6500 } } },
  ];
  expect(lastSuccessfulAssistantUsage(entries)?.totalTokens).toBe(6500);
  const usage = resolveContextUsage(undefined, 10_000, entries);
  expect(usage?.percent).toBe(65);
  expect(usage?.tokens).toBe(6500);
  expect(resolveContextUsage({ tokens: 100, contextWindow: 10_000, percent: 1 }, 10_000, entries)?.percent).toBe(1);
  expect(resolveContextUsage(undefined, 10_000, [user("u", null)])?.percent).toBeNull();
});

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
  const out = applyContext(state, structuredClone(messages), ctx as never);
  expect(state.lastFieldHashes?.size, "session header must not empty the active view").toBeGreaterThan(0);
  expect(out).toBeDefined();
  expect(state.lastApplied).toBeGreaterThan(0);
  state.index.closeSync();
});

test("persisted confirmation skips fields without a later successful assistant", () => {
  const entries: NativeEntry[] = [user("u", null)];
  let parent = "u";
  const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "question" }] }];
  for (let i = 1; i <= 5; i++) {
    entries.push(call(`c${i}`, parent, `call${i}`), result(`r${i}`, `c${i}`, `call${i}`, "z".repeat(8000)), done(`d${i}`, `r${i}`));
    parent = `d${i}`;
    messages.push(
      { role: "assistant", content: [{ type: "toolCall", id: `call${i}`, name: "read" }] },
      { role: "toolResult", toolCallId: `call${i}`, content: [{ type: "text", text: "z".repeat(8000) }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    );
  }
  // sixth batch: tool result present, no assistant after it → not derived-exposed
  entries.push(call("c6", parent, "call6"), result("r6", "c6", "call6", "z".repeat(8000)));
  parent = "r6";
  messages.push(
    { role: "assistant", content: [{ type: "toolCall", id: "call6", name: "read" }] },
    { role: "toolResult", toolCallId: "call6", content: [{ type: "text", text: "z".repeat(8000) }] },
  );
  const cfg = parseConfig({ schemaVersion: 6, profile: "balanced", storage: { mode: "memory-only" },
    fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 } });
  const state = createPlugin(cfg);
  const ctx = {
    cwd: process.cwd(),
    model: { id: "wire", provider: "controlled", contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 8000, contextWindow: 10000, percent: 80 }),
    sessionManager: { getEntries: () => entries, getSessionId: () => "s", getLeafId: () => parent,
      getEntry: (id: string) => entries.find((e) => e.id === id) },
  };
  applyContext(state, structuredClone(messages), ctx as never);
  const id = state.lastIdentity!;
  const hashes = state.lastFieldHashes!;
  // Fold stubs the original r1 text, so lastFieldHashes no longer carries r1:0.
  const original = sha256Hex("z".repeat(8000));
  expect(state.witness.has(id, "r1:0", original)).toBe(true);
  expect(state.witness.has(id, "r6:0", hashes.get("r6:0") ?? original), "unexposed field must not be confirmed").toBe(false);
  state.index.closeSync();
});

test("error stopReason assistants do not expose a pending tool result", () => {
  const entries: NativeEntry[] = [
    user("u", null),
    call("c1", "u", "call1"),
    result("r1", "c1", "call1", "z".repeat(8000)),
    {
      id: "d1",
      parentId: "r1",
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "failed" }], stopReason: "error", usage: { input: 80, totalTokens: 90 } },
    },
  ];
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "question" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "call1", name: "read" }] },
    { role: "toolResult", toolCallId: "call1", content: [{ type: "text", text: "z".repeat(8000) }] },
    { role: "assistant", content: [{ type: "text", text: "failed" }] },
  ];
  const cfg = parseConfig({
    schemaVersion: 6,
    profile: "balanced",
    storage: { mode: "memory-only" },
    fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
  });
  const state = createPlugin(cfg);
  applyContext(state, structuredClone(messages), {
    cwd: process.cwd(),
    model: { id: "wire", provider: "controlled", contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 8000, contextWindow: 10000, percent: 80 }),
    sessionManager: {
      getEntries: () => entries,
      getSessionId: () => "s",
      getLeafId: () => "d1",
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
  } as never);
  const id = state.lastIdentity!;
  const hashes = state.lastFieldHashes!;
  expect(hashes.has("r1:0")).toBe(true);
  expect(state.witness.has(id, "r1:0", hashes.get("r1:0")!)).toBe(false);
  state.index.closeSync();
});

test("sibling-branch success does not confirm the current branch field", () => {
  const siblingDone = done("d-sib", "r-sib");
  const entries: NativeEntry[] = [
    user("u", null),
    call("c1", "u", "call1"),
    result("r1", "c1", "call1", "z".repeat(8000)),
    done("d1", "r1"),
    call("c-sib", "d1", "call-sib"),
    result("r-sib", "c-sib", "call-sib", "z".repeat(8000)),
    siblingDone,
    call("c2", "d1", "call2"),
    result("r2", "c2", "call2", "z".repeat(8000)),
    done("d2", "r2"),
  ];
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "question" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "call1", name: "read" }] },
    { role: "toolResult", toolCallId: "call1", content: [{ type: "text", text: "z".repeat(8000) }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "call2", name: "read" }] },
    { role: "toolResult", toolCallId: "call2", content: [{ type: "text", text: "z".repeat(8000) }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ];
  const cfg = parseConfig({
    schemaVersion: 6,
    profile: "balanced",
    storage: { mode: "memory-only" },
    fold: { protectRecentBatches: 1, minRemovedTokens: 8, minFoldableBytes: 1024 },
  });
  const state = createPlugin(cfg);
  applyContext(state, structuredClone(messages), {
    cwd: process.cwd(),
    model: { id: "wire", provider: "controlled", contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 8000, contextWindow: 10000, percent: 80 }),
    sessionManager: {
      getEntries: () => entries,
      getSessionId: () => "s",
      getLeafId: () => "d2",
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
  } as never);
  const hashes = state.lastFieldHashes!;
  expect([...hashes.keys()].some((k) => k.startsWith("r-sib:"))).toBe(false);
  state.index.closeSync();
});

test("persisted session originals fold on the first applyContext", () => {
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
  const out = applyContext(state, first, ctx as never);
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

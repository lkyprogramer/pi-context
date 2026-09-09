import { expect, test } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../../src/config.js";
import { applyContext, createPlugin } from "../../src/plugin.js";
import { encodeRef } from "../../src/history/refs.js";
import { readHistory } from "../../src/history/read.js";
import { collectBatches } from "../../src/projection/batches.js";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import { planFold } from "../../src/projection/planner.js";
import { buildActiveView } from "../../src/projection/active-view.js";
import { archiveBranch, latestCompactionId } from "../../src/pi/source-reader.js";
import { archivedFixture, call, done, result, user } from "../helpers/context-audit-fixture.js";
import type { AgentMessage } from "../../src/projection/render.js";

test("summarized-out original is not an outbound candidate", () => {
  const f = archivedFixture();
  const scope = { workspaceId: "w", sessionId: "s", leafId: f.leaf,
    visibleEntryIds: new Set(f.entries.map(e => e.id)) };
  const view = buildActiveView({ scope, entries: f.entries, messages: f.messages });
  expect(view.fields.map(x => x.ref.entryId)).not.toContain("r");
  expect(view.fields.map(x => x.ref.entryId)).toContain("r2");
});

test("P01 archive 80k does not fold when the active view is only the tail", () => {
  const f = archivedFixture();
  const config = parseConfig({ schemaVersion: 6, profile: "balanced", storage: { mode: "memory-only" } });
  expect(config.fold).toMatchObject({
    triggerPercent: 60,
    targetPercent: 40,
    protectRecentBatches: 4,
    minRemovedTokens: 4096,
  });
  const state = createPlugin(config);
  applyContext(state, f.messages as AgentMessage[], {
    cwd: process.cwd(),
    model: { id: "model", contextWindow: 32000 },
    getContextUsage: () => ({ tokens: 22000, contextWindow: 32000, percent: 68.75 }),
    sessionManager: {
      getEntries: () => f.entries,
      getSessionId: () => "s",
      getLeafId: () => f.leaf,
      getEntry: (id: string) => f.entries.find((e) => e.id === id),
    },
  } as never);
  expect(state.telemetry.foldEvents).toHaveLength(0);
  expect(state.lastApplied).toBe(0);
  expect(state.plan?.replacements.has("r:0") ?? false).toBe(false);
  state.index.closeSync();
});

test("active-view field stays readable by the same FieldRef", () => {
  const f = archivedFixture();
  const scope = {
    workspaceId: "w",
    sessionId: "s",
    leafId: f.leaf,
    visibleEntryIds: new Set(f.entries.map((e) => e.id)),
  };
  const view = buildActiveView({ scope, entries: f.entries, messages: f.messages });
  const field = view.fields.find((x) => x.ref.entryId === "r2");
  expect(field).toBeDefined();
  expect(Number.isInteger(field!.messageIndex)).toBe(true);
  expect(field!.blockIndex).toBe(0);
  const read = readHistory({
    scope,
    ref: encodeRef(field!.ref),
    config: DEFAULT_CONFIG,
    getEntry: (id) => f.entries.find((e) => e.id === id),
  });
  expect(read.ok).toBe(true);
  expect(read.verified).toBe(true);
  expect(read.totalBytes).toBe(20000);
  expect(field!.rawText.startsWith(read.page ?? "")).toBe(true);
  expect((read.page ?? "").length).toBeGreaterThan(0);
});

test("sibling compaction later in the file does not become the current boundary", () => {
  const entries = [
    user("u", null),
    { id: "c1", parentId: "u", type: "compaction", summary: "on-branch" },
    user("now", "c1"),
    { id: "c2", parentId: "u", type: "compaction", summary: "sibling-later" },
  ];
  const walked = archiveBranch(entries, "now");
  expect(walked.diagnostics).toEqual([]);
  expect(walked.branch.map((e) => e.id)).toEqual(["u", "c1", "now"]);
  expect(latestCompactionId(entries, "now")).toBe("c1");
  expect(latestCompactionId(entries)).toBe("c2");
  const scope = { workspaceId: "w", sessionId: "s", leafId: "now", visibleEntryIds: new Set(entries.map((e) => e.id)) };
  const view = buildActiveView({ scope, entries, messages: [{ role: "user", content: [{ type: "text", text: "question" }] }] });
  expect(view.compactionBoundary).toBe("c1");
});

test("same content on different events stays two fields", () => {
  const text = "shared-body".repeat(200);
  const entries = [
    user("u", null),
    call("c1", "u", "a"),
    result("r1", "c1", "a", text),
    done("d1", "r1"),
    call("c2", "d1", "b"),
    result("r2", "c2", "b", text),
    done("d2", "r2"),
  ];
  const messages = entries.filter((e) => e.message).map((e) => structuredClone(e.message!));
  const scope = { workspaceId: "w", sessionId: "s", leafId: "d2", visibleEntryIds: new Set(entries.map((e) => e.id)) };
  const view = buildActiveView({ scope, entries, messages });
  expect(view.fields.map((x) => x.ref.entryId)).toEqual(["r1", "r2"]);
});

test("active old results beyond the protected tail still fold", () => {
  const entries = [user("u", null)];
  let parent = "u";
  for (let i = 1; i <= 8; i++) {
    entries.push(call(`c${i}`, parent, `call${i}`), result(`r${i}`, `c${i}`, `call${i}`, "z".repeat(8000)), done(`d${i}`, `r${i}`));
    parent = `d${i}`;
  }
  const messages = entries.filter((e) => e.message).map((e) => structuredClone(e.message!));
  const scope = { workspaceId: "w", sessionId: "s", leafId: parent, visibleEntryIds: new Set(entries.map((e) => e.id)) };
  const view = buildActiveView({ scope, entries, messages });
  expect(view.fields.map((x) => x.ref.entryId)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
  const plan = planFold({
    scope,
    view,
    batches: collectBatches(view.branch),
    exposed: exposedEntryIds(view.branch),
    usage: { tokens: 8000, contextWindow: 10000, percent: 80 },
    previous: null,
    modelId: "m",
    cfg: DEFAULT_CONFIG,
    configHash: "h",
  });
  expect(plan).not.toBeNull();
  expect([...plan!.replacements.keys()]).toContain("r1:0");
  expect([...plan!.replacements.keys()]).not.toContain("r8:0");
});

import { homedir } from "node:os";
import { expect, test } from "vitest";
import { HistoryIndex } from "../../src/history/index.js";
import { createPlugin, openSessionIndex } from "../../src/plugin.js";
import { parseConfig } from "../../src/config.js";
import { user } from "../helpers/context-audit-fixture.js";

test("duplicate rows do not consume insertion headroom", () => {
  const index = HistoryIndex.open({ mode: "memory-only", dbPath: null, maxIndexBytes: 150 });
  const a = user("a", null, "x".repeat(100)), b = user("b", "a", "needle");
  const s = { workspaceId: "w", sessionId: "s", leafId: "a", visibleEntryIds: new Set(["a"]) };
  try {
    index.upsertBranchSync(s, [a]);
    index.upsertBranchSync({ ...s, leafId: "b", visibleEntryIds: new Set(["a", "b"]) }, [a, b]);
    expect(index.status().rows).toBe(2);
    expect(index.status().bytes).toBe(106);
  } finally { index.closeSync(); }
});

test("unchanged leaf does not rehash known fields", () => {
  const index = HistoryIndex.open({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const entries = [user("a", null, "x".repeat(1000)), user("b", "a", "y".repeat(1000))];
  const s = { workspaceId: "w", sessionId: "s", leafId: "b", visibleEntryIds: new Set(["a", "b"]) };
  try {
    index.upsertBranchSync(s, entries);
    expect(index.status().hashedFields).toBe(2);
    expect(index.status().newRows).toBe(2);
    index.upsertBranchSync(s, entries);
    expect(index.status().scannedIds).toBe(0);
    expect(index.status().hashedFields).toBe(0);
    const c = user("c", "b", "z".repeat(50));
    index.upsertBranchSync({ ...s, leafId: "c", visibleEntryIds: new Set(["a", "b", "c"]) }, [...entries, c]);
    expect(index.status().scannedIds).toBe(3);
    expect(index.status().hashedFields).toBe(1);
    expect(index.status().newRows).toBe(1);
    expect(index.status().bytes).toBe(2050);
  } finally { index.closeSync(); }
});

test("quota equal is writable and one extra byte is rejected", () => {
  const index = HistoryIndex.open({ mode: "memory-only", dbPath: null, maxIndexBytes: 100 });
  const a = user("a", null, "x".repeat(100));
  const b = user("b", "a", "y");
  const s = { workspaceId: "w", sessionId: "s", leafId: "a", visibleEntryIds: new Set(["a"]) };
  try {
    expect(index.upsertBranchSync(s, [a])).toBe(1);
    expect(index.status().bytes).toBe(100);
    index.upsertBranchSync({ ...s, leafId: "b", visibleEntryIds: new Set(["a", "b"]) }, [a, b]);
    expect(index.status().rows).toBe(1);
    expect(index.status().warnings).toContain("index-full");
  } finally { index.closeSync(); }
});

test("HOME workspace uses memory-only even when config asks for persistent", () => {
  const state = createPlugin(parseConfig({ schemaVersion: 6, storage: { mode: "persistent", dbPath: null } }));
  openSessionIndex(state, homedir());
  expect(state.index.mode).toBe("memory-only");
  state.index.closeSync();
});

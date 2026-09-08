import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createHistoryIndex } from "../../src/history/index.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

function tr(id: string, parent: string | null, text: string, toolName = "bash"): NativeEntry {
  return {
    id,
    parentId: parent,
    type: "message",
    message: { role: "toolResult", toolCallId: `c-${id}`, toolName, isError: false, content: [{ type: "text", text }] },
  };
}

it("never ranks or returns blocks outside the visible session scope", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const a: Scope = { workspaceId: "w", sessionId: "A", leafId: "a1", visibleEntryIds: new Set(["a1"]) };
  const b: Scope = { workspaceId: "w", sessionId: "B", leafId: "b1", visibleEntryIds: new Set(["b1"]) };
  await idx.upsertBranch(a, [tr("a1", null, "PRIVATE_SYNTHETIC_A appears here")]);
  await idx.upsertBranch(b, [tr("b1", null, "ordinary text")]);
  const hits = await idx.search(b, "PRIVATE_SYNTHETIC_A", 8, 0);
  expect(hits).toEqual([]);
  const own = await idx.search(a, "PRIVATE_SYNTHETIC_A", 8, 0);
  expect(own.map((h) => h.entryId)).toEqual(["a1"]);
  await idx.close();
});

it("offset paginates without duplicates", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const s: Scope = { workspaceId: "w", sessionId: "S", leafId: "e5", visibleEntryIds: new Set(["e1", "e2", "e3", "e4", "e5"]) };
  await idx.upsertBranch(s, [1, 2, 3, 4, 5].map((n) => tr(`e${n}`, n === 1 ? null : `e${n - 1}`, `needle block ${n}`)));
  const p1 = await idx.search(s, "needle", 2, 0);
  const p2 = await idx.search(s, "needle", 2, 2);
  const p3 = await idx.search(s, "needle", 2, 4);
  const ids = [...p1, ...p2, ...p3].map((h) => h.entryId);
  expect(new Set(ids).size).toBe(5);
  expect(ids).toHaveLength(5);
  await idx.close();
});

it("does not leak the same entryId across sessions or sibling leaves", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const a: Scope = { workspaceId: "w", sessionId: "S1", leafId: "e1", visibleEntryIds: new Set(["e1"]) };
  const b: Scope = { workspaceId: "w", sessionId: "S2", leafId: "e1", visibleEntryIds: new Set(["e1"]) };
  await idx.upsertBranch(a, [tr("e1", null, "PRIVATE_SYNTHETIC_A session one")]);
  await idx.upsertBranch(b, [tr("e1", null, "harmless session two")]);
  expect(await idx.search(b, "PRIVATE_SYNTHETIC_A", 8, 0)).toEqual([]);
  const sibling: Scope = {
    workspaceId: "w",
    sessionId: "S1",
    leafId: "child",
    visibleEntryIds: new Set(["root", "child"]),
  };
  await idx.upsertBranch(sibling, [
    tr("root", null, "shared root"),
    tr("sib", "root", "SIBLING_SECRET stays on the other leaf"),
    tr("child", "root", "visible child text"),
  ]);
  expect(await idx.search(sibling, "SIBLING_SECRET", 8, 0)).toEqual([]);
  expect((await idx.search(sibling, "visible child", 8, 0)).map((h) => h.entryId)).toEqual(["child"]);
  await idx.close();
});

it("skips pctx_history echo rows and refuses writes past maxIndexBytes", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 80 });
  const s: Scope = { workspaceId: "w", sessionId: "S", leafId: "h3", visibleEntryIds: new Set(["h1", "h2", "h3"]) };
  const written = await idx.upsertBranch(s, [
    tr("h1", null, "echotoken from bash"),
    tr("h2", "h1", "echotoken from history tool itself", "pctx_history"),
    tr("h3", "h2", "x".repeat(400)),
  ]);
  expect(written.inserted).toBe(1);
  expect(idx.status().warnings).toContain("index-full");
  const hits = await idx.search(s, "echotoken", 8, 0);
  expect(hits.map((h) => h.entryId)).toEqual(["h1"]);
  await idx.close();
});

it("persistent unwritable dbPath is CONFIG_ERROR not memory fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pctx-idx-"));
  const blocker = join(dir, "not-a-dir");
  writeFileSync(blocker, "nope");
  await expect(
    createHistoryIndex({ mode: "persistent", dbPath: join(blocker, "index.sqlite"), maxIndexBytes: 1 << 20 }),
  ).rejects.toMatchObject({ code: "PCTX_CONFIG" });
});

it("same leaf upsertBranch is a no-op", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const s: Scope = { workspaceId: "w", sessionId: "S", leafId: "e1", visibleEntryIds: new Set(["e1"]) };
  expect((await idx.upsertBranch(s, [tr("e1", null, "needle once")])).inserted).toBe(1);
  expect((await idx.upsertBranch(s, [tr("e1", null, "needle once")])).inserted).toBe(0);
  await idx.close();
});

import { expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { createHistoryIndex } from "../../src/history/index.js";
import { searchHistory } from "../../src/history/search.js";
import { decodeCursor } from "../../src/history/refs.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

function tr(id: string, parent: string | null, text: string): NativeEntry {
  return {
    id,
    parentId: parent,
    type: "message",
    message: { role: "toolResult", toolCallId: `c-${id}`, toolName: "bash", isError: false, content: [{ type: "text", text }] },
  };
}

it("search cursor binds query/branch/index and mismatches restart from offset 0", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const entries = [1, 2, 3, 4].map((n) => tr(`e${n}`, n === 1 ? null : `e${n - 1}`, `needle page ${n}`));
  const scope: Scope = {
    workspaceId: "w",
    sessionId: "S",
    leafId: "e4",
    visibleEntryIds: new Set(entries.map((e) => e.id)),
  };
  await idx.upsertBranch(scope, entries);
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const first = await searchHistory({
    scope,
    query: "needle",
    limit: 2,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
  });
  expect(first.hits).toHaveLength(2);
  expect(first.cursor).toBeTruthy();
  const cur = decodeCursor(first.cursor!);
  expect(cur.v).toBe(6);
  expect(cur.offset).toBe(2);
  const second = await searchHistory({
    scope,
    query: "needle",
    limit: 2,
    cursor: first.cursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
  });
  expect(second.hits).toHaveLength(2);
  const ids = [...(first.hits ?? []), ...(second.hits ?? [])].map((h) => h.entryId);
  expect(new Set(ids).size).toBe(4);
  const mismatched = await searchHistory({
    scope,
    query: "page",
    limit: 2,
    cursor: first.cursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
  });
  expect(mismatched.diagnostic).toMatch(/CURSOR_MISMATCH/);
  expect(mismatched.hits).toHaveLength(2);
  const restarted = decodeCursor(mismatched.cursor!);
  expect(restarted.offset).toBe(2);
  const last = await searchHistory({
    scope,
    query: "needle",
    limit: 8,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
  });
  expect(last.cursor).toBeNull();
  await idx.close();
});

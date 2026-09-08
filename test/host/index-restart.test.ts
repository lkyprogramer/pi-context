import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHistoryIndex } from "../../src/history/index.js";
import { buildScope } from "../../src/history/scope.js";
import type { NativeEntry } from "../../src/contracts.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("reopening a persistent index does not reinsert the same leaf", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pctx-sm-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "pctx-sessions-"));
  const dbDir = mkdtempSync(join(tmpdir(), "pctx-idx-"));
  dirs.push(cwd, sessionDir, dbDir);
  const dbPath = join(dbDir, "index.sqlite");
  const sm = SessionManager.create(cwd, sessionDir);
  sm.appendMessage({
    role: "user",
    content: [{ type: "text", text: "restart-needle stays after reopen" }],
    timestamp: Date.now(),
  } as never);
  const entries = sm.getEntries() as NativeEntry[];
  const scope = buildScope({
    cwd,
    sessionId: sm.getSessionId(),
    leafId: sm.getLeafId(),
    getEntry: (id) => entries.find((e) => e.id === id),
  });
  const first = await createHistoryIndex({ mode: "persistent", dbPath, maxIndexBytes: 1 << 20 });
  const inserted = await first.upsertBranch(scope, entries);
  expect(inserted.inserted).toBeGreaterThan(0);
  const before = await first.search(scope, "restart-needle", 8, 0);
  expect(before.map((h) => h.entryId)).toEqual([sm.getLeafId()]);
  await first.close();
  const second = await createHistoryIndex({ mode: "persistent", dbPath, maxIndexBytes: 1 << 20 });
  expect((await second.upsertBranch(scope, entries)).inserted).toBe(0);
  const after = await second.search(scope, "restart-needle", 8, 0);
  expect(after.map((h) => h.entryId)).toEqual(before.map((h) => h.entryId));
  await second.close();
});

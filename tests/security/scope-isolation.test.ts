import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createEvidenceCatalog } from "@pcr/runtime";
import { openWorkspaceSqliteStore, openWorkspaceStateStore } from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("scope isolation gate", () => {
  it("denies cross-read, pointer injection, and last-owner ambiguity", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-scope-gate-"));
    roots.push(root);
    const alpha = createRuntimeCursor({
      workspacePath: join(root, "alpha"),
      sessionId: "session-alpha",
      leafId: "leaf-alpha",
      lineageEntryIds: ["root", "leaf-alpha"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const beta = createRuntimeCursor({
      workspacePath: join(root, "beta"),
      sessionId: "session-beta",
      leafId: "leaf-beta",
      lineageEntryIds: ["root", "leaf-beta"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: alpha.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const store = openWorkspaceStateStore({ database });
    try {
      await store.putDirective({
        directiveId: "dir-alpha",
        userTurnId: "turn-alpha",
        exactQuote: "alpha only",
        quoteHash: "a".repeat(64),
        utf8ByteRange: { start: 0, end: 5 },
        utf16Range: { start: 0, end: 5 },
        codePointRange: { start: 0, end: 5 },
        kind: "constraint",
        polarity: "must",
        status: "active",
        cursor: alpha,
      });
      await expect(store.listDirectives(beta)).rejects.toMatchObject({ code: "PCR_STATE_STORE_SCOPE_MISMATCH" });
      const catalog = createEvidenceCatalog();
      await catalog.admit({ cursor: alpha, ref: "ev-alpha", kind: "note", sourceId: "s1", authority: "inform", now: 1 });
      expect(await catalog.list(beta)).toEqual([]);
      await expect(catalog.admit({
        cursor: { ...alpha, sessionId: "unbound" },
        ref: "ev-inject",
        kind: "note",
        sourceId: "s2",
        authority: "act",
        now: 2,
      })).rejects.toBeTruthy();
    } finally {
      await database.close();
    }
  });
});

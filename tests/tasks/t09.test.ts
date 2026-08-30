import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { blobId } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import {
  WORKSPACE_SQLITE_SCHEMA_VERSION,
  openWorkspaceSqliteStore,
  type OpenWorkspaceSqliteStoreInput,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function freshRoot(label = "fixture"): string {
  const root = mkdtempSync(join(tmpdir(), `pcr-t09-${label}-`));
  roots.push(root);
  return root;
}

function cursor(root: string, overrides: Partial<{
  sessionId: string;
  leafId: string | null;
  lineageEntryIds: string[];
  modelKey: string;
}> = {}) {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId: overrides.sessionId ?? "session-t09",
    leafId: overrides.leafId === undefined ? "leaf-t09" : overrides.leafId,
    lineageEntryIds: overrides.lineageEntryIds ?? ["entry-root", "leaf-t09"],
    modelKey: overrides.modelKey ?? "openclaw/Qwen3.8-27B-WORK",
  });
}

function record(scope: ReturnType<typeof cursor>, overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence_t09",
    cursor: scope,
    operationId: "operation_t09",
    observationId: "observation_t09",
    rawBlobId: blobId(`blob_${"a".repeat(64)}`),
    reducer: { id: "shell", revision: "v1" },
    kind: "tool-output",
    value: { text: "persisted", nested: { exitCode: 0 } },
    sourceClass: "trusted-tool" as const,
    authority: "inform" as const,
    sourceRefs: ["tool-call-t09"],
    validity: { kind: "observed", at: 9 },
    contentHash: "9".repeat(64),
    observedAt: 9,
    ...overrides,
  };
}

function openInput(root: string, workspaceId: string, overrides: Partial<OpenWorkspaceSqliteStoreInput> = {}) {
  return { dataRoot: root, workspaceId, busyTimeoutMs: 1_000, ...overrides };
}

async function runT09Fixture(): Promise<{ ok: true; task: "T09" }> {
  const root = freshRoot();
  const scope = cursor(root);
  const store = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: scope.workspaceId,
    busyTimeoutMs: 1_000,
  });
  try {
    await store.put(record(scope));
    expect(await store.get(scope, "evidence_t09")).toMatchObject({
      evidenceId: "evidence_t09",
      cursor: scope,
      value: { text: "persisted", nested: { exitCode: 0 } },
    });
  } finally {
    await store.close();
  }
  return { ok: true, task: "T09" };
}

describe("T09 Per-workspace SQLite schema and migrations", () => {
  it("per_workspace_sqlite_schema_and_migrations", async () => {
    await expect(runT09Fixture()).resolves.toEqual({ ok: true, task: "T09" });
  });

  it("round-trips every cursor and provenance field without SQL defaults", async () => {
    const root = freshRoot("roundtrip");
    const scope = cursor(root, { leafId: null, lineageEntryIds: ["session-header-id"] });
    const expected = record(scope);
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      await store.put(expected);
      expect(await store.get(scope, expected.evidenceId)).toEqual(expected);
      expect(store.path).toBe(join(root, scope.workspaceId, "runtime.sqlite"));
    } finally {
      await store.close();
    }
  });

  it("makes identical put idempotent and rejects a conflicting replay without overwrite", async () => {
    const root = freshRoot("idempotent");
    const scope = cursor(root);
    const expected = record(scope);
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      await store.put(expected);
      await store.put(structuredClone(expected));
      await store.put(record(scope, { value: { nested: { exitCode: 0 }, text: "persisted" } }));
      const conflicts = [
        record(scope, { value: { text: "changed" } }),
        record(scope, { authority: "act" }),
        record(scope, { sourceClass: "untrusted-tool" }),
        record(scope, { rawBlobId: blobId(`blob_${"b".repeat(64)}`) }),
        record(scope, { contentHash: "8".repeat(64) }),
        record(cursor(root, { leafId: "other-leaf", lineageEntryIds: ["entry-root", "other-leaf"] })),
      ];
      for (const conflict of conflicts) {
        await expect(store.put(conflict)).rejects.toMatchObject({ code: "PCR_SQLITE_EVIDENCE_CONFLICT" });
      }
      expect(await store.get(scope, expected.evidenceId)).toEqual(expected);
    } finally {
      await store.close();
    }
  });

  it("requires the full session, leaf, lineage and model cursor on read", async () => {
    const root = freshRoot("scope");
    const scope = cursor(root);
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      await store.put(record(scope));
      const wrongScopes = [
        cursor(root, { sessionId: "other-session" }),
        cursor(root, { leafId: "other-leaf", lineageEntryIds: ["entry-root", "other-leaf"] }),
        cursor(root, { lineageEntryIds: ["different-root", "leaf-t09"] }),
        cursor(root, { modelKey: "openclaw/other-model" }),
      ];
      for (const wrong of wrongScopes) {
        await expect(store.get(wrong, "evidence_t09")).resolves.toBeNull();
      }
    } finally {
      await store.close();
    }
  });

  it("isolates workspaces physically and does not disclose cross-workspace ids", async () => {
    const root = freshRoot("workspaces");
    const a = cursor(join(root, "project-a"));
    const b = cursor(join(root, "project-b"));
    const storeA = await openWorkspaceSqliteStore(openInput(root, a.workspaceId));
    const storeB = await openWorkspaceSqliteStore(openInput(root, b.workspaceId));
    try {
      await storeA.put(record(a));
      await storeB.put(record(b));
      expect(storeA.path).not.toBe(storeB.path);
      await expect(storeA.get(b, "evidence_t09")).resolves.toBeNull();
      await expect(storeA.put(record(b))).rejects.toMatchObject({ code: "PCR_SQLITE_WORKSPACE_MISMATCH" });
      await expect(storeB.get(b, "evidence_t09")).resolves.toEqual(record(b));
    } finally {
      await storeA.close();
      await storeB.close();
    }
  });

  it("reopens the same workspace with immutable migration history", async () => {
    const root = freshRoot("reopen");
    const scope = cursor(root);
    const first = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    await first.put(record(scope));
    expect(first.getSchemaVersion()).toBe(WORKSPACE_SQLITE_SCHEMA_VERSION);
    await first.close();
    const reopened = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      expect(reopened.getSchemaVersion()).toBe(1);
      expect(await reopened.get(scope, "evidence_t09")).toEqual(record(scope));
    } finally {
      await reopened.close();
    }
  });

  it("rejects a second in-process writer for the same workspace path", async () => {
    const root = freshRoot("writer");
    const scope = cursor(root);
    const first = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      await expect(openWorkspaceSqliteStore(openInput(root, scope.workspaceId))).rejects.toMatchObject({
        code: "PCR_SQLITE_WRITER_LOCKED",
      });
    } finally {
      await first.close();
    }
  });

  it("fails a pre-aborted open before creating workspace storage", async () => {
    const root = freshRoot("abort");
    const scope = cursor(root);
    const controller = new AbortController();
    const reason = new Error("cancel-t09");
    controller.abort(reason);
    await expect(
      openWorkspaceSqliteStore(openInput(root, scope.workspaceId, { signal: controller.signal })),
    ).rejects.toBe(reason);
    expect(existsSync(join(root, scope.workspaceId))).toBe(false);
  });

  it("fails closed on migration checksum drift and preserves the database", async () => {
    const root = freshRoot("drift");
    const scope = cursor(root);
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    await store.put(record(scope));
    const path = store.path;
    await store.close();
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE schema_migration SET checksum = ? WHERE version = 1").run("0".repeat(64));
    raw.close();
    await expect(openWorkspaceSqliteStore(openInput(root, scope.workspaceId))).rejects.toMatchObject({
      code: "PCR_SQLITE_SCHEMA_DRIFT",
    });
    expect(existsSync(path)).toBe(true);
  });

  it("rejects a copied database whose durable workspace identity differs", async () => {
    const root = freshRoot("copied");
    const source = cursor(join(root, "source"));
    const target = cursor(join(root, "target"));
    const store = await openWorkspaceSqliteStore(openInput(root, source.workspaceId));
    await store.put(record(source));
    const sourcePath = store.path;
    await store.close();
    const targetRoot = join(root, target.workspaceId);
    mkdirSync(targetRoot, { recursive: true });
    copyFileSync(sourcePath, join(targetRoot, "runtime.sqlite"));
    await expect(openWorkspaceSqliteStore(openInput(root, target.workspaceId))).rejects.toMatchObject({
      code: "PCR_SQLITE_WORKSPACE_MISMATCH",
    });
  });

  it("rejects malformed input, maps filesystem failure, and fails after close", async () => {
    const root = freshRoot("negative");
    const scope = cursor(root);
    await expect(openWorkspaceSqliteStore({} as never)).rejects.toMatchObject({ code: "PCR_SQLITE_INPUT_INVALID" });
    const blockingFile = join(root, "busy-not-a-directory");
    writeFileSync(blockingFile, "x");
    await expect(openWorkspaceSqliteStore(openInput(blockingFile, scope.workspaceId))).rejects.toMatchObject({
      code: "PCR_SQLITE_IO",
    });
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    await store.close();
    await store.close();
    await expect(store.get(scope, "evidence_t09")).rejects.toMatchObject({ code: "PCR_SQLITE_CLOSED" });
  });

  it("rejects a durable row whose blob reference is not a canonical CAS address", async () => {
    const root = freshRoot("invalid-blob-ref");
    const scope = cursor(root);
    const store = await openWorkspaceSqliteStore(openInput(root, scope.workspaceId));
    try {
      await store.put(record(scope));
      const raw = new DatabaseSync(store.path);
      try {
        raw.prepare("UPDATE evidence SET raw_blob_id = 'blob-public'").run();
      } finally {
        raw.close();
      }
      await expect(store.get(scope, "evidence_t09")).rejects.toMatchObject({
        code: "PCR_SQLITE_INPUT_INVALID",
      });
    } finally {
      await store.close();
    }
  });

  it("replays deterministically across independent workspace stores", async () => {
    const firstRoot = freshRoot("deterministic-a");
    const secondRoot = freshRoot("deterministic-b");
    const firstScope = cursor(firstRoot);
    const secondScope = { ...firstScope, workspaceId: cursor(secondRoot).workspaceId };
    const firstRecord = record(firstScope);
    const secondRecord = record(secondScope);
    const first = await openWorkspaceSqliteStore(openInput(firstRoot, firstScope.workspaceId));
    const second = await openWorkspaceSqliteStore(openInput(secondRoot, secondScope.workspaceId));
    try {
      await first.put(firstRecord);
      await second.put(secondRecord);
      const left = await first.get(firstScope, "evidence_t09");
      const right = await second.get(secondScope, "evidence_t09");
      expect({ ...left, cursor: { ...left!.cursor, workspaceId: "normalized" } }).toEqual({
        ...right,
        cursor: { ...right!.cursor, workspaceId: "normalized" },
      });
    } finally {
      await first.close();
      await second.close();
    }
  });
});

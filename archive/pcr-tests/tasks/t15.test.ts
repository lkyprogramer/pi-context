import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createProductionReducers, createReducerRegistry } from "@pcr/core";
import { createEvidenceService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceEvidenceRepository,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-t15-"));
  roots.push(value);
  return value;
}

function cursor(root: string, sessionId = "session-t15") {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId,
    leafId: "leaf-t15",
    lineageEntryIds: ["root", "leaf-t15"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function openStack(root: string, bound = cursor(root)) {
  const key = Buffer.alloc(32, 15);
  const blobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    maxBlobBytes: 64 * 1024,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t15", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t15" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const repository = openWorkspaceEvidenceRepository({ database });
  const fts = openWorkspaceEvidenceFtsIndex({ database });
  const service = createEvidenceService({
    cursor: bound,
    repository,
    fts,
    blobs,
  });
  return { bound, blobs, database, repository, fts, service };
}

async function runT15Fixture(): Promise<{ ok: true; task: "T15" }> {
  const root = dataRoot();
  const stack = await openStack(root);
  try {
    const bound = stack.bound;
    const registry = createReducerRegistry({
      cursor: bound,
      reducers: createProductionReducers(),
    });
    const text = "cache invalidation strategy\nerror: boom\nexit code 1";
    const reduced = await registry.reduce({
      observation: {
        operationId: "op-t15",
        cursor: bound,
        toolCallId: "call-t15",
        toolName: "bash",
        args: { command: "npm test" },
        content: [{ type: "text", text }],
        details: { exitCode: 1 },
        isError: true,
        capturedAt: 15,
        sourceClass: "untrusted-tool",
        authority: "inform",
      },
      text,
      rawBlobId: "blob_" + "a".repeat(64),
      cursor: bound,
    });
    const plain = Buffer.from(text, "utf8");
    const rawBlobId = await stack.blobs.put(bound, plain);
    const admitted = await stack.service.admit({
      cursor: bound,
      operationId: "op-t15",
      observationId: "obs-t15",
      rawBlobId,
      reducer: { id: reduced.reducer.id, revision: "1" },
      sourceClass: "untrusted-tool",
      facts: reduced.facts as Array<{ kind: string; value: unknown }>,
      observedAt: 15,
      visibleText: reduced.visibleText,
    });
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.every((record) => record.authority === "inform")).toBe(true);
    expect(admitted.every((record) => record.sourceClass === "untrusted-tool")).toBe(true);
    expect(admitted.every((record) => record.rawBlobId === rawBlobId)).toBe(true);
    expect(admitted.every((record) => record.reducer.revision === "1")).toBe(true);

    const hits = await stack.service.search({ cursor: bound, text: "cache invalidation" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.evidenceId).toBe(admitted[0]?.evidenceId);

    const page = await stack.service.read({
      cursor: bound,
      evidenceId: admitted[0]!.evidenceId,
    });
    expect(page.verified).toBe(true);
    expect(page.byteLength).toBe(plain.byteLength);
    expect(page.sha256).toBe(sha256(plain));
    expect(Buffer.from(page.bytes)).toEqual(plain);
    return { ok: true, task: "T15" };
  } finally {
    await stack.database.close();
  }
}

describe("T15 Evidence admission, FTS indexing and exact read", () => {
  it("evidence_admission_fts_indexing_and_exact_read", async () => {
    await expect(runT15Fixture()).resolves.toEqual({ ok: true, task: "T15" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createEvidenceService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_EVIDENCE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed admission before writing", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      await expect(stack.service.admit({} as never)).rejects.toThrow(/PCR_EVIDENCE_INPUT_INVALID/);
    } finally {
      await stack.database.close();
    }
  });

  it("does not elevate untrusted origin even when a reducer requests act", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const plain = Buffer.from("deployed", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      const [record] = await stack.service.admit({
        cursor: stack.bound,
        operationId: "op-launder",
        observationId: "obs-launder",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "agent-derived",
        originSourceClass: "untrusted-tool",
        facts: [{ kind: "outcome", value: "deployed", requestedAuthority: "act" }],
        observedAt: 15,
        visibleText: "deployed",
      });
      expect(record?.sourceClass).toBe("untrusted-tool");
      expect(record?.authority).toBe("inform");
    } finally {
      await stack.database.close();
    }
  });

  it("replays duplicate admission with the same evidence ids", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const plain = Buffer.from("same-bytes", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      const input = {
        cursor: stack.bound,
        operationId: "op-dup",
        observationId: "obs-dup",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "trusted-tool" as const,
        facts: [{ kind: "exit-code", value: 0 }],
        observedAt: 15,
        visibleText: "ok",
      };
      const first = await stack.service.admit(input);
      const second = await stack.service.admit(input);
      expect(second).toEqual(first);
      const hits = await stack.service.search({ cursor: stack.bound, text: "ok" });
      expect(hits.map((hit) => hit.evidenceId).sort()).toEqual(first.map((record) => record.evidenceId).sort());
    } finally {
      await stack.database.close();
    }
  });

  it("denies search and exact read from another workspace session", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const plain = Buffer.from("scoped-secret", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      const [record] = await stack.service.admit({
        cursor: stack.bound,
        operationId: "op-scope",
        observationId: "obs-scope",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "untrusted-tool",
        facts: [{ kind: "note", value: "scoped-secret" }],
        observedAt: 15,
        visibleText: "scoped-secret",
      });
      const other = cursor(root, "other-session");
      await expect(stack.service.search({ cursor: other, text: "scoped-secret" })).rejects.toThrow(
        /PCR_EVIDENCE_SCOPE_MISMATCH/,
      );
      await expect(stack.service.read({
        cursor: other,
        evidenceId: record!.evidenceId,
      })).rejects.toThrow(/PCR_EVIDENCE_SCOPE_MISMATCH/);
    } finally {
      await stack.database.close();
    }
  });

  it("stops at the abort boundary before admitting", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const controller = new AbortController();
      controller.abort();
      const plain = Buffer.from("aborted", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      await expect(stack.service.admit({
        cursor: stack.bound,
        operationId: "op-abort",
        observationId: "obs-abort",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "trusted-tool",
        facts: [{ kind: "note", value: "aborted" }],
        observedAt: 15,
        signal: controller.signal,
      })).rejects.toThrow();
      const hits = await stack.service.search({ cursor: stack.bound, text: "aborted" });
      expect(hits).toEqual([]);
    } finally {
      await stack.database.close();
    }
  });

  it("exact read is deterministic across two runs and preserves a byte range", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const plain = Buffer.from("ABCDEFGHIJ", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      const [record] = await stack.service.admit({
        cursor: stack.bound,
        operationId: "op-range",
        observationId: "obs-range",
        rawBlobId,
        reducer: { id: "read", revision: "1" },
        sourceClass: "trusted-tool",
        facts: [{ kind: "read-range", value: { path: "a.txt", start: 1, end: 4 } }],
        observedAt: 15,
        visibleText: "ABCDEFGHIJ",
      });
      const first = await stack.service.read({
        cursor: stack.bound,
        evidenceId: record!.evidenceId,
        range: { start: 2, endExclusive: 6 },
      });
      const second = await stack.service.read({
        cursor: stack.bound,
        evidenceId: record!.evidenceId,
        range: { start: 2, endExclusive: 6 },
      });
      expect(second).toEqual(first);
      expect(first.verified).toBe(true);
      expect(first.byteLength).toBe(plain.byteLength);
      expect(first.sha256).toBe(sha256(plain));
      expect(Buffer.from(first.bytes)).toEqual(Buffer.from("CDEF"));
    } finally {
      await stack.database.close();
    }
  });
});

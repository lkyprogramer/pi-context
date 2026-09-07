import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createRetrievalTools } from "@pcr/pi-adapter";
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
  const value = mkdtempSync(join(tmpdir(), "pcr-t20-"));
  roots.push(value);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function openStack(root: string) {
  const bound = createRuntimeCursor({
    workspacePath: root,
    sessionId: "session-t20",
    leafId: "leaf-t20",
    lineageEntryIds: ["root", "leaf-t20"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 20);
  const blobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    maxBlobBytes: 64 * 1024,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t20", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t20" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const evidence = createEvidenceService({
    cursor: bound,
    repository: openWorkspaceEvidenceRepository({ database }),
    fts: openWorkspaceEvidenceFtsIndex({ database }),
    blobs,
  });
  return { bound, blobs, database, evidence };
}

async function runT20Fixture(): Promise<{ ok: true; task: "T20" }> {
  const root = dataRoot();
  const stack = await openStack(root);
  try {
    const plain = Buffer.from("cache invalidation strategy", "utf8");
    const rawBlobId = await stack.blobs.put(stack.bound, plain);
    const [record] = await stack.evidence.admit({
      cursor: stack.bound,
      operationId: "op-t20",
      observationId: "obs-t20",
      rawBlobId,
      reducer: { id: "bash", revision: "1" },
      sourceClass: "untrusted-tool",
      facts: [{ kind: "note", value: "cache invalidation strategy" }],
      observedAt: 20,
      visibleText: "cache invalidation strategy",
    });
    const tools = createRetrievalTools({ cursor: stack.bound, evidence: stack.evidence });
    const found = await tools.search({ query: "cache invalidation" });
    expect(found.hits[0]?.evidenceId).toBe(record?.evidenceId);
    const page = await tools.read({ evidenceId: record!.evidenceId });
    expect(page.verified).toBe(true);
    expect(page.byteLength).toBe(plain.byteLength);
    expect(page.sha256).toBe(sha256(plain));
    expect(Buffer.from(page.bytes)).toEqual(plain);
    return { ok: true, task: "T20" };
  } finally {
    await stack.database.close();
  }
}

describe("T20 Storage-backed context_search and context_read", () => {
  it("storage_backed_context_search_and_context_read", async () => {
    await expect(runT20Fixture()).resolves.toEqual({ ok: true, task: "T20" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createRetrievalTools({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed and unsafe queries", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const tools = createRetrievalTools({ cursor: stack.bound, evidence: stack.evidence });
      await expect(tools.search({} as never)).rejects.toThrow(/PCR_RETRIEVAL_INPUT_INVALID/);
      await expect(tools.search({ query: "SELECT * FROM t" })).rejects.toMatchObject({ code: "PCR_SEARCH_UNSAFE" });
    } finally {
      await stack.database.close();
    }
  });

  it("replays search and exact read deterministically", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const plain = Buffer.from("deterministic-t20", "utf8");
      const rawBlobId = await stack.blobs.put(stack.bound, plain);
      const [record] = await stack.evidence.admit({
        cursor: stack.bound,
        operationId: "op-dup",
        observationId: "obs-dup",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "trusted-tool",
        facts: [{ kind: "note", value: "deterministic-t20" }],
        observedAt: 20,
        visibleText: "deterministic-t20",
      });
      const tools = createRetrievalTools({ cursor: stack.bound, evidence: stack.evidence });
      const first = await tools.search({ query: "deterministic-t20" });
      const second = await tools.search({ query: "deterministic-t20" });
      expect(second).toEqual(first);
      const readOnce = await tools.read({ evidenceId: record!.evidenceId });
      const readTwice = await tools.read({ evidenceId: record!.evidenceId });
      expect(readTwice).toEqual(readOnce);
    } finally {
      await stack.database.close();
    }
  });

  it("denies another session scope", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const tools = createRetrievalTools({ cursor: stack.bound, evidence: stack.evidence });
      const other = createRuntimeCursor({
        workspacePath: root,
        sessionId: "other-session",
        leafId: "leaf-t20",
        lineageEntryIds: ["root", "leaf-t20"],
        modelKey: "openclaw/Qwen3.8-27B-WORK",
      });
      await expect(tools.search({ query: "cache", cursor: other })).rejects.toMatchObject({
        code: "PCR_RETRIEVAL_SCOPE_DENIED",
      });
    } finally {
      await stack.database.close();
    }
  });

  it("stops at the abort boundary before search", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const tools = createRetrievalTools({ cursor: stack.bound, evidence: stack.evidence });
      const controller = new AbortController();
      controller.abort();
      await expect(tools.search({ query: "cache", signal: controller.signal })).rejects.toThrow();
    } finally {
      await stack.database.close();
    }
  });
});

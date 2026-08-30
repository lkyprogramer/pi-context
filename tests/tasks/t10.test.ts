import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createEncryptedBlobStore } from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

async function runT10Fixture(): Promise<{ ok: true; task: "T10" }> {
  const dataRoot = mkdtempSync(join(tmpdir(), "pcr-t10-red-"));
  roots.push(dataRoot);
  const cursor = createRuntimeCursor({
    workspacePath: dataRoot,
    sessionId: "session-t10",
    leafId: "leaf-t10",
    lineageEntryIds: ["entry-root", "leaf-t10"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 10);
  const store = createEncryptedBlobStore({
    dataRoot,
    workspaceId: cursor.workspaceId,
    maxBlobBytes: 1024 * 1024,
    keys: {
      async current() { return { keyId: "key-t10", key }; },
      async get(_workspaceId, keyId) { return keyId === "key-t10" ? key : null; },
    },
  });
  const plain = Buffer.from("encrypted durable bytes", "utf8");
  const ref = await store.put(cursor, plain);
  expect(await store.put(cursor, plain)).toBe(ref);
  expect(await store.read(cursor, ref)).toEqual(plain);
  expect(await store.read(cursor, ref, { start: 10, endExclusive: 17 })).toEqual(Buffer.from("durable"));
  return { ok: true, task: "T10" };
}

describe("T10 Encrypted content-addressed blob store", () => {
  it("encrypted_content_addressed_blob_store", async () => {
    await expect(runT10Fixture()).resolves.toEqual({ ok: true, task: "T10" });
  });

  it("fails closed for malformed dependencies", () => {
    expect(() => createEncryptedBlobStore({} as never)).toThrowError(expect.objectContaining({
      code: "PCR_BLOB_INPUT_INVALID",
    }));
  });

  it("rejects the wrong session and branch cursor before key access", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pcr-t10-scope-"));
    roots.push(dataRoot);
    const cursor = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-source",
      leafId: "leaf-source",
      lineageEntryIds: ["root", "leaf-source"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    let reads = 0;
    const key = Buffer.alloc(32, 4);
    const store = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return { keyId: "key-scope", key }; },
        async get() { reads += 1; return key; },
      },
    });
    const ref = await store.put(cursor, Buffer.from("scoped"));
    const wrong = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-other",
      leafId: "leaf-other",
      lineageEntryIds: ["root", "leaf-other"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    await expect(store.read(wrong, ref)).rejects.toMatchObject({ code: "PCR_BLOB_SCOPE_MISMATCH" });
    expect(reads).toBe(0);
  });

  it("propagates cancellation at the key-provider I/O boundary without publishing", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pcr-t10-cancel-"));
    roots.push(dataRoot);
    const cursor = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-cancel",
      leafId: "leaf-cancel",
      lineageEntryIds: ["root", "leaf-cancel"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const cancelled = new DOMException("cancelled", "AbortError");
    const store = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { throw cancelled; },
        async get() { return null; },
      },
    });
    await expect(store.put(cursor, Buffer.from("cancelled"))).rejects.toBe(cancelled);
  });
});

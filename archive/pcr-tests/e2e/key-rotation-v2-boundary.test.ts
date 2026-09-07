import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
} from "@pcr/storage-node";
import { rotateWorkspaceKeys } from "../../packages/storage/src/operations/key-rotation.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("v2 CAS key-rotation boundary", () => {
  it("fails before mutating a cursor-scoped envelope with the legacy rotation protocol", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pcr-v2-rotation-boundary-"));
    roots.push(dataRoot);
    const cursor = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-rotation",
      leafId: "leaf-rotation",
      lineageEntryIds: ["root", "leaf-rotation"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const oldKey = Buffer.alloc(32, 1);
    const newKey = Buffer.alloc(32, 2);
    const store = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("old", oldKey); },
        async get(_workspaceId, keyId) {
          return keyId === "old" ? createWorkspaceBlobKeyLease(oldKey) : null;
        },
      },
    });
    const ref = await store.put(cursor, Buffer.from("must survive rejected legacy rotation"));
    const workspaceRoot = join(dataRoot, cursor.workspaceId);
    const path = join(workspaceRoot, "blobs", "sha256", ref.slice(5, 7), `${ref}.bin`);
    const before = readFileSync(path);

    await expect(rotateWorkspaceKeys({
      workspaceRoot,
      workspaceId: cursor.workspaceId,
      oldKey,
      newKey,
    })).rejects.toMatchObject({ code: "PCR_ROTATION_V2_UNSUPPORTED" });

    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(join(workspaceRoot, "keys", "rotation.json"))).toBe(false);
    expect(await store.read(cursor, ref)).toEqual(Buffer.from("must survive rejected legacy rotation"));
  });

  it("rejects a damaged v2 header before creating legacy rotation state", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pcr-v2-rotation-damaged-"));
    roots.push(dataRoot);
    const cursor = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-damaged",
      leafId: "leaf-damaged",
      lineageEntryIds: ["root", "leaf-damaged"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const oldKey = Buffer.alloc(32, 3);
    const store = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("old", oldKey); },
        async get(_workspaceId, keyId) {
          return keyId === "old" ? createWorkspaceBlobKeyLease(oldKey) : null;
        },
      },
    });
    const ref = await store.put(cursor, Buffer.from("damaged v2"));
    const workspaceRoot = join(dataRoot, cursor.workspaceId);
    const path = join(workspaceRoot, "blobs", "sha256", ref.slice(5, 7), `${ref}.bin`);
    const damaged = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete damaged.keyId;
    writeFileSync(path, JSON.stringify(damaged), { mode: 0o600 });
    const before = readFileSync(path);

    await expect(rotateWorkspaceKeys({
      workspaceRoot,
      workspaceId: cursor.workspaceId,
      oldKey,
      newKey: Buffer.alloc(32, 4),
    })).rejects.toMatchObject({ code: "PCR_ROTATION_V2_UNSUPPORTED" });

    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(join(workspaceRoot, "keys", "rotation.json"))).toBe(false);
  });
});

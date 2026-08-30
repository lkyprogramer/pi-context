import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createUserTurnService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSqliteStore,
  openWorkspaceUserTurnLedger,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

async function runT12Fixture(): Promise<{ ok: true; task: "T12" }> {
  const dataRoot = mkdtempSync(join(tmpdir(), "pcr-t12-red-"));
  roots.push(dataRoot);
  const cursor = createRuntimeCursor({
    workspacePath: dataRoot,
    sessionId: "session-t12",
    leafId: "leaf-t12",
    lineageEntryIds: ["root", "leaf-t12"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 12);
  const blobs = createEncryptedBlobStore({
    dataRoot,
    workspaceId: cursor.workspaceId,
    maxBlobBytes: 4096,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t12", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t12" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const database = await openWorkspaceSqliteStore({
    dataRoot,
    workspaceId: cursor.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const ledger = await openWorkspaceUserTurnLedger({ database });
  const service = createUserTurnService({ cursor, blobs, ledger });
  try {
    const rawText = "改为版本 7 🚀；保留精确原文";
    const receipt = await service.capture({
      operationId: "input-t12",
      cursor,
      rawText,
      sourceClass: "authenticated-user",
      capturedAt: 12,
    });
    const linked = await service.link(receipt.receiptId, "pi-entry-t12");
    expect(linked).toMatchObject({
      cursor,
      hostMessageId: "pi-entry-t12",
      rawTextHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      utf8Bytes: Buffer.byteLength(rawText, "utf8"),
    });
    expect(await blobs.read(cursor, linked.rawBlobId)).toEqual(Buffer.from(rawText, "utf8"));
    return { ok: true, task: "T12" };
  } finally {
    await ledger.close();
    await database.close();
  }
}

describe("T12 Exact user input ledger and Pi correlation", () => {
  it("exact_user_input_ledger_and_pi_correlation", async () => {
    await expect(runT12Fixture()).resolves.toEqual({ ok: true, task: "T12" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createUserTurnService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_USER_TURN_DEPENDENCY_MISSING" }),
    );
  });
});

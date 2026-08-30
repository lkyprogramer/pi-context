import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("evidence recovery", () => {
  it("reads the admitted blob and compares sha256 plus byte length", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-evidence-recovery-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-recovery",
      leafId: "leaf-recovery",
      lineageEntryIds: ["root", "leaf-recovery"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = Buffer.alloc(32, 21);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("key-recovery", key); },
        async get(_workspaceId, keyId) {
          return keyId === "key-recovery" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    try {
      const service = createEvidenceService({
        cursor,
        repository: openWorkspaceEvidenceRepository({ database }),
        fts: openWorkspaceEvidenceFtsIndex({ database }),
        blobs,
      });
      const plain = Buffer.from("exact recovery payload", "utf8");
      const rawBlobId = await blobs.put(cursor, plain);
      const [record] = await service.admit({
        cursor,
        operationId: "op-recovery",
        observationId: "obs-recovery",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "untrusted-tool",
        facts: [{ kind: "note", value: "exact recovery payload" }],
        observedAt: 21,
        visibleText: "exact recovery payload",
      });
      const page = await service.read({ cursor, evidenceId: record!.evidenceId });
      expect(page.verified).toBe(true);
      expect(page.byteLength).toBe(plain.byteLength);
      expect(page.sha256).toBe(sha256(plain));
      expect(Buffer.from(page.bytes)).toEqual(plain);
      const denied = createRuntimeCursor({
        workspacePath: root,
        sessionId: "other-session",
        leafId: "leaf-recovery",
        lineageEntryIds: ["root", "leaf-recovery"],
        modelKey: "openclaw/Qwen3.8-27B-WORK",
      });
      await expect(service.read({ cursor: denied, evidenceId: record!.evidenceId })).rejects.toThrow(
        /PCR_EVIDENCE_SCOPE_MISMATCH/,
      );
    } finally {
      await database.close();
    }
  });
});

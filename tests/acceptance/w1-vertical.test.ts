import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createEvidenceService, createObservationService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceEvidenceRepository,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

import { runW1Vertical } from "../../scripts/gates/w1-vertical.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("W1 vertical acceptance", () => {
  it("recovers the admitted blob and ranks the FTS hit from real CAS bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-w1-vertical-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-w1-vertical",
      leafId: "leaf-w1-vertical",
      lineageEntryIds: ["root", "leaf-w1-vertical"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = Buffer.alloc(32, 23);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("key-w1-vertical", key); },
        async get(_workspaceId, keyId) {
          return keyId === "key-w1-vertical" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    try {
      const evidence = await runW1Vertical({
        cursor,
        observation: createObservationService({ cursor, blobs, saga }),
        evidence: createEvidenceService({
          cursor,
          repository: openWorkspaceEvidenceRepository({ database }),
          fts: openWorkspaceEvidenceFtsIndex({ database }),
          blobs,
        }),
        blobs,
        text: "cache invalidation strategy\nerror: boom\nexit code 1",
        operationId: "op-w1-vertical",
      });
      expect(evidence.rawHash).toMatch(/^[a-f0-9]{64}$/);
      expect(evidence.exactReadHash).toBe(evidence.rawHash);
      expect(evidence.visibleTokens).toBeGreaterThan(0);
      expect(Number.isFinite(evidence.searchRank)).toBe(true);
    } finally {
      await saga.close();
      await database.close();
    }
  });
});

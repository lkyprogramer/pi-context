import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createReadTool, createRetrievalTools, createSearchTool } from "@pcr/pi-adapter";
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

describe("retrieval tools", () => {
  it("searches FTS and exact-reads the admitted blob", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-retrieval-tools-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-retrieval",
      leafId: "leaf-retrieval",
      lineageEntryIds: ["root", "leaf-retrieval"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = Buffer.alloc(32, 20);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("key-retrieval", key); },
        async get(_workspaceId, keyId) {
          return keyId === "key-retrieval" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    try {
      const evidence = createEvidenceService({
        cursor,
        repository: openWorkspaceEvidenceRepository({ database }),
        fts: openWorkspaceEvidenceFtsIndex({ database }),
        blobs,
      });
      const plain = Buffer.from("exact retrieval payload", "utf8");
      const rawBlobId = await blobs.put(cursor, plain);
      const [record] = await evidence.admit({
        cursor,
        operationId: "op-retrieval",
        observationId: "obs-retrieval",
        rawBlobId,
        reducer: { id: "bash", revision: "1" },
        sourceClass: "untrusted-tool",
        facts: [{ kind: "note", value: "exact retrieval payload" }],
        observedAt: 20,
        visibleText: "exact retrieval payload",
      });
      const port = createRetrievalTools({ cursor, evidence });
      const searchTool = createSearchTool({ cursor, evidence });
      const readTool = createReadTool({ cursor, evidence });
      const found = await port.search({ query: "exact retrieval" });
      expect(found.hits[0]?.evidenceId).toBe(record?.evidenceId);
      const viaTool = await searchTool.execute("c1", { query: "exact retrieval" }, undefined, undefined, {
        workspaceId: cursor.workspaceId,
      });
      expect(JSON.parse(viaTool.content[0]?.text ?? "{}").hits[0].evidenceId).toBe(record?.evidenceId);
      const page = await port.read({ evidenceId: record!.evidenceId });
      expect(page.sha256).toBe(sha256(plain));
      expect(page.byteLength).toBe(plain.byteLength);
      const readOut = await readTool.execute("c2", { evidenceId: record!.evidenceId }, undefined, undefined, {
        workspaceId: cursor.workspaceId,
      });
      expect(JSON.parse(readOut.content[0]?.text ?? "{}")).toMatchObject({
        verified: true,
        sha256: sha256(plain),
        byteLength: plain.byteLength,
      });
    } finally {
      await database.close();
    }
  });
});

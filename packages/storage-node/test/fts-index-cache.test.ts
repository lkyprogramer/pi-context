import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blobId, type EvidenceRecord, type RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import {
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceSqliteStore,
  type WorkspaceSqliteEvidenceStore,
} from "@pcr/storage-node";

import { getWorkspaceSqliteAccess } from "../src/internal/sqlite-access.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pcr-fts-cache-"));
  roots.push(root);
  return root;
}

function cursor(
  root: string,
  overrides: Partial<{
    sessionId: string;
    leafId: string | null;
    lineageEntryIds: string[];
    modelKey: string;
  }> = {},
): RuntimeCursor {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId: overrides.sessionId ?? "session-fts-cache",
    leafId: overrides.leafId === undefined ? "leaf-fts-cache" : overrides.leafId,
    lineageEntryIds: overrides.lineageEntryIds ?? ["root", "leaf-fts-cache"],
    modelKey: overrides.modelKey ?? "openclaw/Qwen3.8-27B-WORK",
  });
}

function evidence(scope: RuntimeCursor, evidenceId: string): EvidenceRecord {
  return {
    evidenceId,
    cursor: scope,
    operationId: `operation-${evidenceId}`,
    observationId: `observation-${evidenceId}`,
    rawBlobId: blobId(`blob_${"a".repeat(64)}`),
    reducer: { id: "fts-cache", revision: "1" },
    kind: "note",
    value: { evidenceId },
    sourceClass: "trusted-tool",
    authority: "inform",
    sourceRefs: ["fts-cache-test"],
    validity: { kind: "observed", at: 1 },
    contentHash: "b".repeat(64),
    observedAt: 1,
  };
}

async function openDatabase(root: string, scope: RuntimeCursor): Promise<WorkspaceSqliteEvidenceStore> {
  return openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: scope.workspaceId,
    busyTimeoutMs: 1_000,
  });
}

async function insertEvidence(
  database: WorkspaceSqliteEvidenceStore,
  index: ReturnType<typeof openWorkspaceEvidenceFtsIndex>,
  record: EvidenceRecord,
  body = "shared cache phrase",
): Promise<void> {
  await database.put(record);
  await index.upsert(record, body);
}

function countFullFtsSearches(database: WorkspaceSqliteEvidenceStore): {
  count(): number;
  restore(): void;
} {
  const access = getWorkspaceSqliteAccess(database);
  if (!access) throw new Error("workspace sqlite access is required for the real SQLite fixture");
  const originalRead = access.read.bind(access);
  let searches = 0;
  const read = vi.spyOn(access, "read").mockImplementation((stage, work) => {
    if (stage === "search-evidence-fts") searches += 1;
    return originalRead(stage, work);
  });
  return {
    count: () => searches,
    restore: () => read.mockRestore(),
  };
}

describe("WorkspaceEvidenceFtsIndex latest-query cache", () => {
  it("does not reissue the full FTS query for an unchanged repeated lookup", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const index = openWorkspaceEvidenceFtsIndex({ database });
    const measure = countFullFtsSearches(database);
    try {
      const record = evidence(scope, "evidence-cache-repeat");
      await insertEvidence(database, index, record);

      const first = await index.search({ cursor: scope, text: "shared cache phrase", limit: 10 });
      const second = await index.search({ cursor: scope, text: "shared cache phrase", limit: 10 });

      expect(first.map((hit) => hit.evidenceId)).toEqual([record.evidenceId]);
      expect(second).toEqual(first);
      expect(measure.count()).toBe(1);
    } finally {
      measure.restore();
      await database.close();
    }
  });

  it("returns a fresh result copy after a caller mutates a cached lookup", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const index = openWorkspaceEvidenceFtsIndex({ database });
    const measure = countFullFtsSearches(database);
    try {
      const record = evidence(scope, "evidence-cache-copy");
      await insertEvidence(database, index, record);

      const first = await index.search({ cursor: scope, text: "shared cache phrase" });
      first[0]!.kind = "mutated";
      first.push({ evidenceId: "invented", kind: "invented", rank: 0 });

      const second = await index.search({ cursor: scope, text: "shared cache phrase" });

      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject({ evidenceId: record.evidenceId, kind: "note" });
      expect(measure.count()).toBe(1);
    } finally {
      measure.restore();
      await database.close();
    }
  });

  it("invalidates a cached lookup when another index writes through the same SQLite connection", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const cachedIndex = openWorkspaceEvidenceFtsIndex({ database });
    const writerIndex = openWorkspaceEvidenceFtsIndex({ database });
    const measure = countFullFtsSearches(database);
    try {
      const first = evidence(scope, "evidence-cache-same-connection-first");
      const second = evidence(scope, "evidence-cache-same-connection-second");
      await insertEvidence(database, cachedIndex, first);
      await database.put(second);

      await cachedIndex.search({ cursor: scope, text: "shared cache phrase" });
      await writerIndex.upsert(second, "shared cache phrase");
      const refreshed = await cachedIndex.search({ cursor: scope, text: "shared cache phrase" });

      expect(refreshed.map((hit) => hit.evidenceId).sort()).toEqual([first.evidenceId, second.evidenceId].sort());
      expect(measure.count()).toBe(2);
    } finally {
      measure.restore();
      await database.close();
    }
  });

  it("invalidates a cached lookup after a separate SQLite connection writes", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const index = openWorkspaceEvidenceFtsIndex({ database });
    const measure = countFullFtsSearches(database);
    try {
      const first = evidence(scope, "evidence-cache-other-connection-first");
      const second = evidence(scope, "evidence-cache-other-connection-second");
      await insertEvidence(database, index, first);
      await database.put(second);
      await index.search({ cursor: scope, text: "shared cache phrase" });

      const other = new DatabaseSync(database.path, { timeout: 1_000 });
      try {
        other.prepare("INSERT INTO evidence_fts(evidence_id, body) VALUES (?, ?)").run(
          second.evidenceId,
          "shared cache phrase",
        );
      } finally {
        other.close();
      }

      const refreshed = await index.search({ cursor: scope, text: "shared cache phrase" });

      expect(refreshed.map((hit) => hit.evidenceId).sort()).toEqual([first.evidenceId, second.evidenceId].sort());
      expect(measure.count()).toBe(2);
    } finally {
      measure.restore();
      await database.close();
    }
  });

  it("does not turn a pre-aborted request into a cache hit", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const index = openWorkspaceEvidenceFtsIndex({ database });
    const measure = countFullFtsSearches(database);
    try {
      const record = evidence(scope, "evidence-cache-abort");
      await insertEvidence(database, index, record);
      await index.search({ cursor: scope, text: "shared cache phrase" });
      const controller = new AbortController();
      const reason = new Error("cancelled-before-cache-read");
      controller.abort(reason);

      await expect(
        index.search({ cursor: scope, text: "shared cache phrase", signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(measure.count()).toBe(1);
    } finally {
      measure.restore();
      await database.close();
    }
  });

  it("keeps limit and every cursor field in the cache key", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const database = await openDatabase(root, scope);
    const index = openWorkspaceEvidenceFtsIndex({ database });
    try {
      const primary = evidence(scope, "evidence-cache-primary");
      const secondPrimary = evidence(scope, "evidence-cache-primary-second");
      await insertEvidence(database, index, primary);
      await insertEvidence(database, index, secondPrimary);

      const variants = [
        cursor(root, { sessionId: "other-session" }),
        cursor(root, { leafId: "other-leaf" }),
        cursor(root, { lineageEntryIds: ["other-root", "leaf-fts-cache"] }),
        cursor(root, { modelKey: "openclaw/other-model" }),
      ];
      const records = variants.map((variant, index) => evidence(variant, `evidence-cache-cursor-${index}`));
      for (const record of records) await insertEvidence(database, index, record);

      const limited = await index.search({ cursor: scope, text: "shared cache phrase", limit: 1 });
      const complete = await index.search({ cursor: scope, text: "shared cache phrase", limit: 2 });
      const otherText = await index.search({ cursor: scope, text: "shared cache phrase absent", limit: 2 });
      expect(limited).toHaveLength(1);
      expect(complete.map((hit) => hit.evidenceId).sort()).toEqual([primary.evidenceId, secondPrimary.evidenceId].sort());
      expect(otherText).toEqual([]);

      for (const [offset, variant] of variants.entries()) {
        const result = await index.search({ cursor: variant, text: "shared cache phrase" });
        expect(result.map((hit) => hit.evidenceId)).toEqual([records[offset]!.evidenceId]);
      }
    } finally {
      await database.close();
    }
  });
});

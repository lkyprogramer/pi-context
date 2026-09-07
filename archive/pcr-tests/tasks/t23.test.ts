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

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-t23-"));
  roots.push(value);
  return value;
}

async function openStack(root: string) {
  const bound = createRuntimeCursor({
    workspacePath: root,
    sessionId: "session-t23",
    leafId: "leaf-t23",
    lineageEntryIds: ["root", "leaf-t23"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 23);
  const blobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    maxBlobBytes: 64 * 1024,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t23", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t23" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const saga = await openWorkspaceSagaJournal({
    database,
    async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
  });
  const observation = createObservationService({ cursor: bound, blobs, saga });
  const evidence = createEvidenceService({
    cursor: bound,
    repository: openWorkspaceEvidenceRepository({ database }),
    fts: openWorkspaceEvidenceFtsIndex({ database }),
    blobs,
  });
  return { bound, blobs, database, saga, observation, evidence };
}

async function runT23Fixture(): Promise<{ ok: true; task: "T23" }> {
  const root = dataRoot();
  const stack = await openStack(root);
  try {
    const first = await runW1Vertical({
      cursor: stack.bound,
      observation: stack.observation,
      evidence: stack.evidence,
      blobs: stack.blobs,
      text: "cache invalidation strategy\nerror: boom\nexit code 1",
      operationId: "op-t23",
    });
    expect(first.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.exactReadHash).toBe(first.rawHash);
    expect(first.visibleTokens).toBeGreaterThan(0);
    expect(typeof first.searchRank).toBe("number");
    const second = await runW1Vertical({
      cursor: stack.bound,
      observation: stack.observation,
      evidence: stack.evidence,
      blobs: stack.blobs,
      text: "cache invalidation strategy\nerror: boom\nexit code 1",
      operationId: "op-t23",
    });
    expect(second).toEqual(first);
    return { ok: true, task: "T23" };
  } finally {
    await stack.saga.close();
    await stack.database.close();
  }
}

describe("T23 Deterministic W1 vertical acceptance gate", () => {
  it("deterministic_w1_vertical_acceptance_gate", async () => {
    await expect(runT23Fixture()).resolves.toEqual({ ok: true, task: "T23" });
  });

  it("fails construction when production dependencies are absent", async () => {
    await expect(runW1Vertical({} as never)).rejects.toMatchObject({
      code: "PCR_W1_VERTICAL_DEPENDENCY_MISSING",
    });
  });

  it("rejects empty tool text", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      await expect(runW1Vertical({
        cursor: stack.bound,
        observation: stack.observation,
        evidence: stack.evidence,
        blobs: stack.blobs,
        text: "",
      })).rejects.toMatchObject({ code: "PCR_W1_VERTICAL_INPUT_INVALID" });
    } finally {
      await stack.saga.close();
      await stack.database.close();
    }
  });

  it("stops at the abort boundary before ingest", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(runW1Vertical({
        cursor: stack.bound,
        observation: stack.observation,
        evidence: stack.evidence,
        blobs: stack.blobs,
        text: "cache invalidation",
        signal: controller.signal,
      })).rejects.toThrow();
    } finally {
      await stack.saga.close();
      await stack.database.close();
    }
  });
});

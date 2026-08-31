import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createCandidateKey, type CandidateKey } from "@pcr/runtime";
import {
  openWorkspaceCandidateRepository,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "t37-"));
  roots.push(root);
  return root;
}

function cursor(root: string, leafId = "leaf-t37") {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId: "session-t37",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function keyFor(root: string, sourceHead = domainHash("t37-head", "h1")): CandidateKey {
  const bound = cursor(root);
  return createCandidateKey({
    cursor: bound,
    sourceHead,
    configFingerprint: domainHash("t37-config", "v1"),
  });
}

async function runT37Fixture() {
  const root = dataRoot();
  const bound = cursor(root);
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const repository = await openWorkspaceCandidateRepository({ database });
  const key = keyFor(root);
  const prepared = await repository.prepare(key);
  expect(prepared.phase).toBe("prepared");
  expect(prepared.key).toMatch(/^[a-f0-9]{64}$/u);
  expect(prepared.sourceHead).toBe(key.sourceHead);
  const published = await repository.publish(prepared.id, key.sourceHead);
  expect(published).toBe(true);
  const replayed = await repository.prepare(key);
  expect(replayed).toEqual({ ...prepared, phase: "committed" });
  expect(await repository.publish(prepared.id, key.sourceHead)).toBe(true);
  await database.close();
  const reopened = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: bound.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const recovered = await openWorkspaceCandidateRepository({ database: reopened });
  expect(await recovered.publish(prepared.id, key.sourceHead)).toBe(true);
  const otherHead = domainHash("t37-head", "h2");
  const next = await recovered.prepare(keyFor(root, otherHead));
  expect(next.phase).toBe("prepared");
  expect(await recovered.publish(next.id, key.sourceHead)).toBe(false);
  await reopened.close();
  return { ok: true as const, task: "T37" as const, prepared };
}

describe("T37 Durable background candidate and generation fencing", () => {
  it("durable_background_candidate_and_generation_fenc", async () => {
    await expect(runT37Fixture()).resolves.toMatchObject({ ok: true, task: "T37" });
  });

  it("fails construction when production dependencies are absent", async () => {
    await expect(openWorkspaceCandidateRepository({} as never)).rejects.toMatchObject({
      code: "PCR_CANDIDATE_DEPENDENCY_MISSING",
    });
  });

  it("rejects malformed prepare input and invalid stale transitions", async () => {
    const root = dataRoot();
    const bound = cursor(root);
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: bound.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const repository = await openWorkspaceCandidateRepository({ database });
    await expect(repository.prepare({} as never)).rejects.toMatchObject({
      code: "PCR_CANDIDATE_INPUT_INVALID",
    });
    const prepared = await repository.prepare(keyFor(root));
    expect(await repository.publish(prepared.id, prepared.sourceHead)).toBe(true);
    await expect(repository.stale(prepared.id, "head-changed")).rejects.toMatchObject({
      code: "PCR_CANDIDATE_INPUT_INVALID",
    });
    await database.close();
  });

  it("replays prepare for the same key to an equal candidate", async () => {
    const root = dataRoot();
    const bound = cursor(root);
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: bound.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const repository = await openWorkspaceCandidateRepository({ database });
    const key = keyFor(root);
    const first = await repository.prepare(key);
    const second = await repository.prepare(key);
    expect(second).toEqual(first);
    expect(first.phase).toBe("prepared");
    await database.close();
  });

  it("rejects a candidate key from another workspace", async () => {
    const root = dataRoot();
    const bound = cursor(root);
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: bound.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const repository = await openWorkspaceCandidateRepository({ database });
    const other = createCandidateKey({
      cursor: createRuntimeCursor({
        workspacePath: `${root}-other`,
        sessionId: "session-t37",
        leafId: "leaf-t37",
        lineageEntryIds: ["root", "leaf-t37"],
        modelKey: bound.modelKey,
      }),
      sourceHead: domainHash("t37-head", "h1"),
      configFingerprint: domainHash("t37-config", "v1"),
    });
    await expect(repository.prepare(other)).rejects.toMatchObject({
      code: "PCR_CANDIDATE_SCOPE_MISMATCH",
    });
    await database.close();
  });

  it("stops at the abort boundary before writing a candidate", async () => {
    const root = dataRoot();
    const bound = cursor(root);
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: bound.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const repository = await openWorkspaceCandidateRepository({ database });
    await expect(repository.prepare({
      ...keyFor(root),
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    await database.close();
  });
});

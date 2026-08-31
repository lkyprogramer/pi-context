import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createReleasePublisher } from "../../release/manifest.mjs";

const WORKSPACE = "ws-t54";
const EMPTY_DIFF = createHash("sha256").update("").digest("hex");
const COMMIT = "c".repeat(40);

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function artifacts(overrides: Record<string, unknown> = {}) {
  return {
    async packageHash() { return sha("tarball"); },
    async compatHash() { return sha("compat"); },
    async gateBundleHash() { return sha("gate"); },
    async rollbackDrill() { return { hash: sha("rollback"), log: "pi remove\nreinstall previous tarball\n" }; },
    ...overrides,
  };
}

function files() {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    async writeFile(path: string, bytes: Uint8Array) { blobs.set(path, bytes); },
  };
}

function git(dirty = false) {
  return {
    async status(scope: { workspaceId: string }) {
      if (scope.workspaceId !== WORKSPACE) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return { commit: COMMIT, dirty, diffHash: dirty ? sha("dirty") : EMPTY_DIFF };
    },
  };
}

async function runT54Fixture() {
  const publisher = createReleasePublisher({
    workspaceId: WORKSPACE,
    version: "0.1.0-alpha.1",
    git: git(),
    artifacts: artifacts(),
    files: files(),
  });
  const manifest = await publisher.publish({ workspaceId: WORKSPACE });
  expect(manifest).toEqual({
    version: "0.1.0-alpha.1",
    commit: COMMIT,
    packageHash: sha("tarball"),
    compatHash: sha("compat"),
    gateBundleHash: sha("gate"),
    rollbackDrillHash: sha("rollback"),
  });
  await expect(createReleasePublisher({
    workspaceId: WORKSPACE,
    version: "0.1.0-alpha.1",
    git: git(true),
    artifacts: artifacts(),
    files: files(),
  }).publish({ workspaceId: WORKSPACE })).rejects.toMatchObject({ code: "PCR_RELEASE_DIRTY_TREE" });
  return { ok: true as const, task: "T54" as const, manifest };
}

describe("T54 Release, rollback and finding closure", () => {
  it("release_rollback_and_finding_closure", async () => {
    await expect(runT54Fixture()).resolves.toMatchObject({ ok: true, task: "T54" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createReleasePublisher({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RELEASE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed publish input", async () => {
    await expect(createReleasePublisher({
      workspaceId: WORKSPACE,
      version: "0.1.0-alpha.1",
      git: git(),
      artifacts: artifacts(),
      files: files(),
    }).publish({} as never)).rejects.toMatchObject({ code: "PCR_RELEASE_INPUT_INVALID" });
  });

  it("replays equal manifests for the same artifacts", async () => {
    const publisher = createReleasePublisher({
      workspaceId: WORKSPACE,
      version: "0.1.0-alpha.1",
      git: git(),
      artifacts: artifacts(),
      files: files(),
    });
    const first = await publisher.publish({ workspaceId: WORKSPACE });
    const second = await publisher.publish({ workspaceId: WORKSPACE });
    expect(second).toEqual(first);
  });

  it("denies publish from another workspace", async () => {
    await expect(createReleasePublisher({
      workspaceId: WORKSPACE,
      version: "0.1.0-alpha.1",
      git: git(),
      artifacts: artifacts(),
      files: files(),
    }).publish({ workspaceId: "ws-other" })).rejects.toMatchObject({
      code: "PCR_RELEASE_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before hashing artifacts", async () => {
    let reads = 0;
    const publisher = createReleasePublisher({
      workspaceId: WORKSPACE,
      version: "0.1.0-alpha.1",
      git: git(),
      artifacts: {
        async packageHash() { reads += 1; return sha("tarball"); },
        async compatHash() { reads += 1; return sha("compat"); },
        async gateBundleHash() { reads += 1; return sha("gate"); },
        async rollbackDrill() { reads += 1; return { hash: sha("rollback"), log: "x" }; },
      },
      files: {
        async writeFile() { reads += 1; },
      },
    });
    await expect(publisher.publish({ workspaceId: WORKSPACE, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(reads).toBe(0);
  });
});

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createReleasePublisher, processArtifacts, sha256Files } from "../../release/manifest.mjs";

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

  it("CLI artifacts fail closed without the tarball and gate-bundle paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-t54-"));
    try {
      await expect(processArtifacts(root, {}).packageHash()).rejects.toMatchObject({
        code: "PCR_RELEASE_INPUT_INVALID",
        details: { field: "PCR_RELEASE_TARBALL" },
      });
      await expect(processArtifacts(root, { PCR_RELEASE_TARBALL: join(root, "pkg.tgz") }).gateBundleHash()).rejects.toMatchObject({
        code: "PCR_RELEASE_INPUT_INVALID",
        details: { field: "PCR_RELEASE_GATE_BUNDLE" },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compatHash is independent of the checkout absolute path", () => {
    const a = mkdtempSync(join(tmpdir(), "pcr-t54-a-"));
    const b = mkdtempSync(join(tmpdir(), "pcr-t54-b-"));
    try {
      for (const root of [a, b]) {
        mkdirSync(join(root, "compat"));
        writeFileSync(join(root, "compat/toolchain.lock.json"), "{\"node\":\"22.19.0\"}\n");
        writeFileSync(join(root, "compat/pi.lock.json"), "{\"pi\":\"0.84.4\"}\n");
      }
      const rels = ["compat/toolchain.lock.json", "compat/pi.lock.json"];
      expect(sha256Files(a, rels)).toBe(sha256Files(b, rels));
      expect(sha256Files(a, rels)).toBe(createHash("sha256")
        .update("compat/toolchain.lock.json")
        .update("{\"node\":\"22.19.0\"}\n")
        .update("compat/pi.lock.json")
        .update("{\"pi\":\"0.84.4\"}\n")
        .digest("hex"));
      expect(() => sha256Files(a, [join(a, "compat/toolchain.lock.json")])).toThrowError(
        expect.objectContaining({ code: "PCR_RELEASE_INPUT_INVALID" }),
      );
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("gateBundleHash digests PCR_RELEASE_GATE_BUNDLE, not T49 evidence.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-t54-gate-"));
    try {
      writeFileSync(join(root, "bundle.json"), "{\"kind\":\"writeImmutableBundle\"}\n");
      mkdirSync(join(root, "artifacts/task-evidence/T49"), { recursive: true });
      writeFileSync(join(root, "artifacts/task-evidence/T49/evidence.json"), "{\"taskId\":\"T49\"}\n");
      writeFileSync(join(root, "pkg.tgz"), "tarball-bytes");
      const artifacts = processArtifacts(root, {
        PCR_RELEASE_TARBALL: join(root, "pkg.tgz"),
        PCR_RELEASE_GATE_BUNDLE: join(root, "bundle.json"),
      });
      await expect(artifacts.gateBundleHash()).resolves.toBe(sha("{\"kind\":\"writeImmutableBundle\"}\n"));
      await expect(artifacts.gateBundleHash()).resolves.not.toBe(sha("{\"taskId\":\"T49\"}\n"));
      await expect(artifacts.packageHash()).resolves.toBe(sha("tarball-bytes"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

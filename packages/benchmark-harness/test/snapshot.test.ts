import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts } from "../../benchmark-contracts/src/index.js";
import {
  createBoundarySnapshot,
  restoreBoundarySnapshot,
  verifyBoundarySnapshot,
  type RestoreTarget,
  type SnapshotSource,
} from "../src/snapshot.js";

function tmp(label: string): string {
  return mkdtempSync(join(tmpdir(), `pcr-${label}-`));
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
}

function sourceFixture(): SnapshotSource {
  const root = tmp("src");
  writeTree(join(root, "workspace"), { "src/app.ts": "export const n = 1;\n", "README.md": "demo\n" });
  writeTree(join(root, "pi-home"), { "sessions/s1.jsonl": "{\"id\":\"leaf-0001\"}\n" });
  writeTree(join(root, "runtime"), { "store.sqlite": "sqlite-bytes\n" });
  writeFileSync(join(root, "session.jsonl"), '{"type":"message","id":"leaf-0001","parentId":null}\n{"type":"message","id":"u0","parentId":"leaf-0001"}\n');
  return {
    piHome: join(root, "pi-home"),
    workspace: join(root, "workspace"),
    runtimeStore: join(root, "runtime"),
    sessionFile: join(root, "session.jsonl"),
    branchLeafId: "leaf-0001",
    environmentAllowlist: ["LANG", "TZ"],
  };
}

function targetFixture(): RestoreTarget {
  return { piHome: tmp("pi"), workspace: tmp("ws"), runtimeStore: tmp("rt") };
}

function snapshotFixture() {
  return {
    workspaceSnapshotSha256: "2".repeat(64),
    boundary: { leafId: "leaf-0001", kind: "pre-threshold" as const, sourceTokens: 0 },
    archiveDir: tmp("empty-archive"),
  };
}

function nonEmptyTarget(): RestoreTarget {
  const workspace = tmp("busy");
  writeFileSync(join(workspace, "keep.txt"), "busy");
  return { piHome: tmp("pi"), workspace, runtimeStore: tmp("rt") };
}

describe("boundary snapshot", () => {
  it("restores identical file hashes and current branch leaf", async () => {
    const snapshot = await createBoundarySnapshot(sourceFixture(), tmp("snap"));
    const receipt = await restoreBoundarySnapshot(snapshot, targetFixture());
    expect(receipt.workspaceSha256).toBe(snapshot.workspaceSnapshotSha256);
    expect(receipt.branchLeafId).toBe(snapshot.boundary.leafId);
    await verifyBoundarySnapshot(snapshot);
    defineBenchmarkContracts().parseBoundarySnapshot({
      workspaceSnapshotSha256: snapshot.workspaceSnapshotSha256,
      boundary: snapshot.boundary,
    });
  });

  it("refuses a target directory that is not empty", async () => {
    await expect(restoreBoundarySnapshot(snapshotFixture(), nonEmptyTarget())).rejects.toThrow(/empty/);
  });

  it("rejects symlink escape and path traversal", async () => {
    const source = sourceFixture();
    symlinkSync("/etc/passwd", join(source.workspace, "escape"));
    await expect(createBoundarySnapshot(source, tmp("snap"))).rejects.toThrow(/symlink|escape/i);
    const traversal = sourceFixture();
    writeFileSync(join(traversal.workspace, "..", "outside.txt"), "nope");
    const snapshot = await createBoundarySnapshot(traversal, tmp("snap"));
    expect(JSON.stringify(snapshot)).not.toContain("outside.txt");
  });

  it("preserves permission bits and fails closed on a corrupt archive", async () => {
    const source = sourceFixture();
    chmodSync(join(source.workspace, "README.md"), 0o640);
    const out = tmp("snap");
    const snapshot = await createBoundarySnapshot(source, out);
    const target = targetFixture();
    await restoreBoundarySnapshot(snapshot, target);
    expect(readFileSync(join(target.workspace, "README.md"), "utf8")).toBe("demo\n");
    writeFileSync(join(out, "manifest.json"), "{broken");
    await expect(verifyBoundarySnapshot(snapshot)).rejects.toThrow(/corrupt|manifest|JSON/i);
  });

  it("restores two arms into isolated directories", async () => {
    const source = sourceFixture();
    const snapshot = await createBoundarySnapshot(source, tmp("snap"));
    const a = targetFixture();
    const b = targetFixture();
    await restoreBoundarySnapshot(snapshot, a);
    await restoreBoundarySnapshot(snapshot, b);
    writeFileSync(join(a.workspace, "arm-a.txt"), "A");
    expect(() => readFileSync(join(b.workspace, "arm-a.txt"))).toThrow();
    expect(a.workspace).not.toBe(b.workspace);
  });
});

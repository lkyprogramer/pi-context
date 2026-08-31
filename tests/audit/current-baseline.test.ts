import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { computeCurrentBaseline, freezeCurrentBaseline } from "../../scripts/audit/freeze-current.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "pcr-a00-"));
  roots.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "a00@example.test"]);
  git(root, ["config", "user.name", "A00"]);
  writeFileSync(join(root, "README.md"), "a00\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

describe("current audit baseline freeze", () => {
  it("two clean-tree freezes produce the same digest", async () => {
    const repo = tempRepo();
    const first = computeCurrentBaseline({ repositoryRoot: repo });
    const second = computeCurrentBaseline({ repositoryRoot: repo });
    expect(first.digest).toBe(second.digest);
    expect(first.baseline.head).toMatch(/^[0-9a-f]{40}$/);
    expect(first.baseline.tree).toBe(second.baseline.tree);
  });

  it("rejects a dirty tree", async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "dirty.txt"), "no\n");
    try {
      freezeCurrentBaseline({
        repositoryRoot: repo,
        outputDirectory: join(repo, "out"),
      });
      throw new Error("expected dirty tree to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "PCR_AUDIT_DIRTY_TREE" });
    }
  });

  it("stops at the abort boundary before git I/O", async () => {
    const repo = tempRepo();
    const signal = AbortSignal.abort(new DOMException("stopped", "AbortError"));
    expect(() =>
      freezeCurrentBaseline({
        repositoryRoot: repo,
        outputDirectory: join(repo, "out"),
        signal,
      }),
    ).toThrow(/stopped|AbortError/);
  });
});

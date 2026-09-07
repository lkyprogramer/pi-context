import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function taskctl(cwd: string, args: string[]) {
  return spawnSync("python3", ["scripts/taskctl.py", ...args], { cwd, encoding: "utf8" });
}

describe("task evidence v2", () => {
  it("rejects an empty-shell evidence.json as done", () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-b03-"));
    roots.push(root);
    git(root, ["init"]);
    git(root, ["config", "user.email", "b03@example.test"]);
    git(root, ["config", "user.name", "B03"]);
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "findings"), { recursive: true });
    mkdirSync(join(root, "artifacts/task-evidence/B00"), { recursive: true });
    writeFileSync(
      join(root, "scripts/taskctl.py"),
      readFileSync("docs/pi-context-deep-audit-and-next-iteration-v2.0.0/scripts/taskctl.py", "utf8"),
    );
    writeFileSync(
      join(root, "tasks/TASK-INDEX.json"),
      `${JSON.stringify([{ id: "B00", dependsOn: [], document: "tasks/B00.md", allowedFiles: ["audit-v2/**"] }], null, 2)}\n`,
    );
    writeFileSync(join(root, "tasks/B00.md"), "# B00\n");
    writeFileSync(join(root, "findings/findings.json"), `${JSON.stringify([{ id: "NF030", remediationTasks: ["B00"] }])}\n`);
    writeFileSync(join(root, ".task-state.json"), `${JSON.stringify({ B00: { status: "claimed", owner: "test" } }, null, 2)}\n`);
    writeFileSync(join(root, "artifacts/task-evidence/B00/evidence.json"), "{}\n");
    writeFileSync(join(root, "README.md"), "b03\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "init"]);
    const result = taskctl(root, ["done", "B00", "--owner", "test"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/empty-evidence|evidence-missing/);
  });

  it("publishes the v2 evidence schema", () => {
    const schema = JSON.parse(readFileSync("schemas/task-evidence.schema.json", "utf8")) as {
      required: string[];
      properties: { schemaVersion: { const: number } };
    };
    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(schema.required).toEqual(expect.arrayContaining([
      "currentHead",
      "allowedDiffSha256",
      "sourceDigest",
      "red",
      "green",
      "fullGate",
      "runBundleHashes",
      "acceptanceAssertions",
      "findingsClosed",
    ]));
  });
});

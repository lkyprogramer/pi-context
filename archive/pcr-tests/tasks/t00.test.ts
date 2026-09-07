import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { freezeAuditBaseline } from "../../audit/baseline.mjs";

const temporaryDirectories: string[] = [];

async function createCommittedRepository(): Promise<string> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "pcr-t00-"));
  temporaryDirectories.push(repositoryRoot);
  execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "t00@example.invalid"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "T00 Test"], { cwd: repositoryRoot });
  await writeFile(join(repositoryRoot, "source.txt"), "immutable source\n", "utf8");
  await writeFile(
    join(repositoryRoot, "findings.json"),
    `${JSON.stringify([{ id: "F029", status: "open" }], null, 2)}\n`,
    "utf8",
  );
  execFileSync("git", ["add", "source.txt", "findings.json"], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repositoryRoot });
  return repositoryRoot;
}

async function runT00Fixture() {
  const repositoryRoot = await createCommittedRepository();
  const outputDirectory = join(repositoryRoot, "artifacts", "audit-baseline");
  const result = await freezeAuditBaseline({
    repositoryRoot,
    sourceFiles: ["source.txt", "findings.json"],
    findingsFile: "findings.json",
    outputDirectory,
  });
  return { outputDirectory, repositoryRoot, result };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("T00 Freeze audit baseline and immutable evidence", () => {
  it("freeze_audit_baseline_and_immutable_evidence", async () => {
    const { outputDirectory, repositoryRoot, result } = await runT00Fixture();

    expect(result).toMatchObject({ ok: true, task: "T00" });
    expect(result.baseline.commit).toBe(
      execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    );
    expect(result.baseline.tree).toBe(
      execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    );
    expect(result.baseline.sourceDigests).toEqual({
      "findings.json": "0172a4a2a21e3da2571fc373168895f7884cfae30b3974c19c528a7e00df92fe",
      "source.txt": "709f5d7b351672d3601d5662ee2ed7a0e42b29fcf8384abf7d1190221b8125ff",
    });
    expect(JSON.parse(await readFile(join(outputDirectory, "baseline-manifest.json"), "utf8"))).toEqual(
      result.baseline,
    );
    expect(await readFile(join(outputDirectory, "findings.snapshot.json"), "utf8")).toBe(
      `${JSON.stringify([{ id: "F029", status: "open" }], null, 2)}\n`,
    );
  });

  it("is idempotent for the same committed inputs", async () => {
    const { outputDirectory, repositoryRoot, result: first } = await runT00Fixture();
    const second = await freezeAuditBaseline({
      repositoryRoot,
      sourceFiles: ["findings.json", "source.txt"],
      findingsFile: "findings.json",
      outputDirectory,
    });

    expect(second).toEqual(first);
  });

  it("rejects a source outside the repository scope", async () => {
    const repositoryRoot = await createCommittedRepository();
    const outputDirectory = join(repositoryRoot, "artifacts", "audit-baseline");

    await expect(
      freezeAuditBaseline({
        repositoryRoot,
        sourceFiles: ["../outside.txt"],
        findingsFile: "findings.json",
        outputDirectory,
      }),
    ).rejects.toThrow("outside repository scope");
  });

  it("rejects an output directory outside the repository scope", async () => {
    const repositoryRoot = await createCommittedRepository();
    const externalRoot = await mkdtemp(join(tmpdir(), "pcr-t00-external-"));
    temporaryDirectories.push(externalRoot);

    await expect(
      freezeAuditBaseline({
        repositoryRoot,
        sourceFiles: ["source.txt", "findings.json"],
        findingsFile: "findings.json",
        outputDirectory: join(externalRoot, "audit-baseline"),
      }),
    ).rejects.toThrow("output directory is outside repository scope");
  });

  it("rejects malformed findings before writing artifacts", async () => {
    const repositoryRoot = await createCommittedRepository();
    const outputDirectory = join(repositoryRoot, "artifacts", "audit-baseline");
    await writeFile(join(repositoryRoot, "findings.json"), "not-json\n", "utf8");

    await expect(
      freezeAuditBaseline({
        repositoryRoot,
        sourceFiles: ["source.txt", "findings.json"],
        findingsFile: "findings.json",
        outputDirectory,
      }),
    ).rejects.toThrow("findings file is not valid JSON");
    await expect(readFile(join(outputDirectory, "baseline-manifest.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not leave partial artifacts when an input disappears", async () => {
    const repositoryRoot = await createCommittedRepository();
    const outputDirectory = join(repositoryRoot, "artifacts", "audit-baseline");
    await rm(join(repositoryRoot, "source.txt"));

    await expect(
      freezeAuditBaseline({
        repositoryRoot,
        sourceFiles: ["source.txt", "findings.json"],
        findingsFile: "findings.json",
        outputDirectory,
      }),
    ).rejects.toThrow("cannot read baseline source");
    await expect(readFile(join(outputDirectory, "findings.snapshot.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replays deterministically in independent output directories", async () => {
    const repositoryRoot = await createCommittedRepository();
    const first = await freezeAuditBaseline({
      repositoryRoot,
      sourceFiles: ["source.txt", "findings.json"],
      findingsFile: "findings.json",
      outputDirectory: join(repositoryRoot, "first"),
    });
    const second = await freezeAuditBaseline({
      repositoryRoot,
      sourceFiles: ["findings.json", "source.txt"],
      findingsFile: "findings.json",
      outputDirectory: join(repositoryRoot, "second"),
    });

    expect(second.baseline).toEqual(first.baseline);
  });
});

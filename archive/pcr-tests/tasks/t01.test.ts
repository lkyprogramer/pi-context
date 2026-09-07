import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCiGate } from "../../scripts/ci/gates.mjs";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "pcr-t01-"));
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}

async function runT01Fixture() {
  const workspaceRoot = await createWorkspace();
  const gate = await runCiGate({
    name: "fixture",
    executable: process.execPath,
    arguments: ["-e", "process.stdout.write('fixture passed\\n')"],
    workspaceRoot,
    logPath: "artifacts/ci/fixture.log",
  });
  return { gate, ok: gate.status === "passed", task: "T01" as const, workspaceRoot };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("T01 Repair lockfile and required CI", () => {
  it("repair_lockfile_and_required_ci", async () => {
    const result = await runT01Fixture();

    expect(result).toMatchObject({ ok: true, task: "T01" });
    expect(result.gate).toMatchObject({ name: "fixture", status: "passed", exitCode: 0 });
    expect(await readFile(result.gate.logPath, "utf8")).toBe("fixture passed\n");
  });

  it("rejects malformed gate names before starting a process", async () => {
    const workspaceRoot = await createWorkspace();

    await expect(
      runCiGate({
        name: "../escape",
        executable: process.execPath,
        arguments: ["--version"],
        workspaceRoot,
        logPath: "artifacts/ci/escape.log",
      }),
    ).rejects.toThrow("gate name");
  });

  it("is idempotent for a deterministic gate", async () => {
    const workspaceRoot = await createWorkspace();
    const input = {
      name: "deterministic",
      executable: process.execPath,
      arguments: ["-e", "process.stdout.write('same\\n')"],
      workspaceRoot,
      logPath: "artifacts/ci/deterministic.log",
    };

    const first = await runCiGate(input);
    const second = await runCiGate(input);

    expect(second).toEqual(first);
    expect(await readFile(first.logPath, "utf8")).toBe("same\n");
  });

  it("rejects log paths outside the workspace", async () => {
    const workspaceRoot = await createWorkspace();

    await expect(
      runCiGate({
        name: "outside",
        executable: process.execPath,
        arguments: ["--version"],
        workspaceRoot,
        logPath: "../outside.log",
      }),
    ).rejects.toThrow("log path is outside workspace");
  });

  it("records command failures without claiming a pass", async () => {
    const workspaceRoot = await createWorkspace();
    const result = await runCiGate({
      name: "failing",
      executable: process.execPath,
      arguments: ["-e", "process.stderr.write('intentional failure\\n'); process.exit(7)"],
      workspaceRoot,
      logPath: "artifacts/ci/failing.log",
    });

    expect(result).toMatchObject({ name: "failing", status: "failed", exitCode: 7 });
    expect(await readFile(result.logPath, "utf8")).toBe("intentional failure\n");
  });

  it("records spawn failures instead of throwing away the CI evidence", async () => {
    const workspaceRoot = await createWorkspace();
    const result = await runCiGate({
      name: "missing-command",
      executable: join(workspaceRoot, "does-not-exist"),
      arguments: [],
      workspaceRoot,
      logPath: "artifacts/ci/missing-command.log",
    });

    expect(result).toMatchObject({ name: "missing-command", status: "failed", exitCode: null });
    expect(await readFile(result.logPath, "utf8")).toContain("ENOENT");
  });

  it("kills an aborted gate and records cancellation", async () => {
    const workspaceRoot = await createWorkspace();
    const controller = new AbortController();
    const pending = runCiGate({
      name: "cancelled",
      executable: process.execPath,
      arguments: ["-e", "setTimeout(() => process.stdout.write('late'), 10_000)"],
      workspaceRoot,
      logPath: "artifacts/ci/cancelled.log",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    const result = await pending;

    expect(result).toMatchObject({ name: "cancelled", status: "failed", aborted: true });
    expect(await readFile(result.logPath, "utf8")).toContain("aborted");
  });

  it("exposes the same gate contract through the CI command", async () => {
    const workspaceRoot = await createWorkspace();
    const commandPath = new URL("../../scripts/ci/run-gate.mjs", import.meta.url);
    const stdout = execFileSync(
      process.execPath,
      [
        commandPath.pathname,
        "--name",
        "cli",
        "--log",
        "artifacts/ci/cli.log",
        "--",
        process.execPath,
        "-e",
        "process.stdout.write('cli passed\\n')",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    expect(stdout).toContain("cli passed\n");
    expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "null")).toMatchObject({
      name: "cli",
      status: "passed",
      exitCode: 0,
    });
    expect(await readFile(join(workspaceRoot, "artifacts/ci/cli.log"), "utf8")).toBe("cli passed\n");
  });
});

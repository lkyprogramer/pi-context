import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createContinuationRunner, type ContinuationAssertion } from "@pcr/benchmark";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function memoryWorkspace(files: Record<string, string>) {
  const current = { ...files };
  return {
    async restore(snapshot: Record<string, string>) {
      Object.keys(current).forEach((key) => { delete current[key]; });
      Object.assign(current, snapshot);
    },
    async apply(toolName: string, args: { path?: string; content?: string }) {
      if (toolName === "write" && args.path && typeof args.content === "string") current[args.path] = args.content;
    },
    async read(path: string) { return current[path] ?? null; },
    async hash() {
      return sha256(JSON.stringify(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))));
    },
  };
}

async function runT45Fixture() {
  const snapshot = { "src/app.ts": "export const version = 3;\n" };
  const workspace = memoryWorkspace(snapshot);
  const runner = createContinuationRunner({
    corpusId: "pcr-bench",
    workspace,
    executor: {
      async run() {
        return {
          toolCalls: [{ toolName: "write", args: { path: "src/app.ts", content: "export const version = 7;\n" } }],
        };
      },
    },
  });
  const assertions: ContinuationAssertion[] = [
    { kind: "file_sha256", path: "src/app.ts", expected: sha256("export const version = 7;\n") },
    { kind: "forbidden_command", pattern: "deploy production" },
  ];
  const result = await runner.run({
    caseId: "temporal-05",
    workspaceId: "ws-t45",
    snapshot,
    assertions,
  });
  expect(result.success).toBe(true);
  expect(result.toolCalls).toEqual([{ toolName: "write", args: { path: "src/app.ts", content: "export const version = 7;\n" } }]);
  expect(result.assertions.every((row) => row.ok)).toBe(true);
  expect(result.finalWorkspaceHash).toMatch(/^[a-f0-9]{64}$/u);
  const failed = await runner.run({
    caseId: "temporal-05",
    workspaceId: "ws-t45",
    snapshot,
    assertions: [{ kind: "file_sha256", path: "src/app.ts", expected: sha256("wrong") }],
  });
  expect(failed.success).toBe(false);
  return { ok: true as const, task: "T45" as const, result };
}

describe("T45 Workspace closed-loop continuation runner", () => {
  it("workspace_closed_loop_continuation_runner", async () => {
    await expect(runT45Fixture()).resolves.toMatchObject({ ok: true, task: "T45" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createContinuationRunner({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CONTINUATION_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed run input", async () => {
    const runner = createContinuationRunner({
      corpusId: "pcr-bench",
      workspace: memoryWorkspace({}),
      executor: { async run() { return { toolCalls: [] }; } },
    });
    await expect(runner.run({} as never)).rejects.toMatchObject({ code: "PCR_CONTINUATION_INPUT_INVALID" });
  });

  it("replays equal workspace hashes for the same snapshot and tools", async () => {
    const snapshot = { "a.txt": "keep" };
    const runner = createContinuationRunner({
      corpusId: "pcr-bench",
      workspace: memoryWorkspace(snapshot),
      executor: { async run() { return { toolCalls: [{ toolName: "write", args: { path: "a.txt", content: "keep" } }] }; } },
    });
    const first = await runner.run({ caseId: "c1", workspaceId: "ws-t45", snapshot, assertions: [] });
    const second = await runner.run({ caseId: "c1", workspaceId: "ws-t45", snapshot, assertions: [] });
    expect(second.finalWorkspaceHash).toBe(first.finalWorkspaceHash);
    expect(second.success).toBe(true);
  });

  it("rejects a run bound to another workspace id", async () => {
    const runner = createContinuationRunner({
      corpusId: "pcr-bench",
      workspace: memoryWorkspace({}),
      executor: { async run() { return { toolCalls: [] }; } },
    });
    await expect(runner.run({
      caseId: "c1",
      workspaceId: "ws-other",
      snapshot: {},
      assertions: [],
      expectedWorkspaceId: "ws-t45",
    })).rejects.toMatchObject({ code: "PCR_CONTINUATION_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before restoring the workspace", async () => {
    let restored = 0;
    const runner = createContinuationRunner({
      corpusId: "pcr-bench",
      workspace: {
        async restore() { restored += 1; },
        async apply() {},
        async read() { return null; },
        async hash() { return "a".repeat(64); },
      },
      executor: { async run() { return { toolCalls: [] }; } },
    });
    await expect(runner.run({
      caseId: "c1",
      workspaceId: "ws-t45",
      snapshot: {},
      assertions: [],
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(restored).toBe(0);
  });
});

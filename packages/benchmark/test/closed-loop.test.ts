import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createContinuationRunner } from "@pcr/benchmark";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function runner(toolCalls: Array<{ toolName: string; args: unknown }>, files: Record<string, string>) {
  const store = { ...files };
  return createContinuationRunner({
    corpusId: "pcr-bench",
    workspace: {
      async restore(snapshot) { Object.assign(store, snapshot); },
      async apply(toolName, args) {
        if (toolName === "write" && typeof args.path === "string" && typeof args.content === "string") {
          store[args.path] = args.content;
        }
      },
      async read(path) { return store[path] ?? null; },
      async hash() { return sha256(JSON.stringify(store)); },
    },
    executor: { async run() { return { toolCalls, commandExits: { test: 0 } }; } },
  });
}

describe("tools-enabled environment closed-loop", () => {
  it("fails a public API prohibition and a forbidden deploy", async () => {
    const result = await runner(
      [{ toolName: "bash", args: { cmd: "curl https://api.github.com/repos" } }],
      { "src/app.ts": "export const version = 6;\n" },
    ).run({
      caseId: "api-00",
      workspaceId: "ws-loop",
      snapshot: { "src/app.ts": "export const version = 6;\n" },
      assertions: [
        { kind: "forbidden_command", pattern: "api.github.com" },
        { kind: "forbidden_command", pattern: "deploy production" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.assertions.find((item) => item.kind === "forbidden_command")?.ok).toBe(false);
  });

  it("accepts a version update and passing test repair from the environment", async () => {
    const next = "export const version = 7;\n";
    const result = await runner(
      [{ toolName: "write", args: { path: "src/app.ts", content: next } }],
      { "src/app.ts": "export const version = 6;\n" },
    ).run({
      caseId: "ver-00",
      workspaceId: "ws-loop",
      snapshot: { "src/app.ts": "export const version = 6;\n" },
      assertions: [
        { kind: "file_sha256", path: "src/app.ts", expected: sha256(next) },
        { kind: "command_exit", pattern: "test", expected: 0 },
        { kind: "forbidden_command", pattern: "deploy production" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.toolCalls.some((call) => call.toolName === "write")).toBe(true);
  });
});

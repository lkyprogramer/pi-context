import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import register from "../../src/extension.js";

const repo = join(import.meta.dirname, "../..");

it("balanced context hook never rewrites the trailing user message", async () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = { on: (name: string, fn: (e: unknown, c: unknown) => unknown) => handlers.set(name, fn), registerTool() {}, registerCommand() {} };
  register(pi as never);
  const messages = [
    { role: "user", content: [{ type: "text", text: "first" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", usage: { input: 1, output: 1, totalTokens: 2 } },
    { role: "user", content: [{ type: "text", text: "second" }] },
  ];
  const ctx = { cwd: repo, sessionManager: { getEntries: () => [], getLeafId: () => null }, getContextUsage: () => ({ tokens: 10, contextWindow: 1000, percent: 1 }), model: { id: "m", contextWindow: 1000 } };
  const out = await handlers.get("context")?.({ type: "context", messages }, ctx);
  expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "second" }] });
  expect(out === undefined || (out as { messages?: unknown[] }).messages?.[2]).toBeTruthy();
  expect(handlers.has("session_before_compact")).toBe(true);
});

it("checkpoint modules are gone", () => {
  expect(existsSync(join(repo, "src/checkpoint"))).toBe(false);
  expect(existsSync(join(repo, "src/projection/exposure.ts"))).toBe(false);
});

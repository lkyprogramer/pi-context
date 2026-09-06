import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  SeedSessionError,
  assertSessionToolPairs,
  classifyPiCompactionError,
  seedScenarioSession,
  usageFromSession,
} from "../src/small-live.js";
import type { Scenario } from "../src/small-runner.js";

const TOOL_TEXT = "observed token=alpha-ancestor-token-7f3c2e";

function toolScenario(): Scenario {
  return {
    id: "delayed-fact-hash",
    clusterId: "reader-hash-fact",
    provenance: "synthetic",
    mode: "reader",
    prompt: "what",
    sourceEntries: [{ id: "t1", role: "tool", text: TOOL_TEXT }],
    oracle: {
      kind: "observed-state",
      expected: "alpha",
      sourceEntryId: "t1",
      sourceSha256: "x".repeat(64),
    },
    workspaceFiles: {},
    assertions: [],
  };
}

it("writes paired toolCall and toolResult instead of an orphan tool role", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcr-seed-pair-"));
  const sessionFile = join(dir, "session.jsonl");
  seedScenarioSession({
    sessionFile,
    cwd: dir,
    scenario: toolScenario(),
    providerModel: "openclaw/Qwen3.8-27B-WORK",
  });
  const raw = readFileSync(sessionFile, "utf8");
  expect(raw).toContain('"type":"toolCall"');
  expect(raw).toContain('"role":"toolResult"');
  expect(raw).toContain("seed_t1");
  expect(raw).toContain('"totalTokens":0');
  expect(raw).toContain(TOOL_TEXT);
  const toolLine = raw.split("\n").find((line) => line.includes('"role":"toolResult"')) ?? "";
  const parsed = JSON.parse(toolLine) as { message: { content: Array<{ text: string }> } };
  expect(parsed.message.content[0]?.text.length).toBeGreaterThanOrEqual(24_000);
  assertSessionToolPairs(sessionFile);
});

it("fail-closes on an orphan toolResult in a seed session", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcr-seed-orphan-"));
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "s", cwd: dir })}\n${JSON.stringify({
    type: "message",
    id: "t1",
    parentId: null,
    message: {
      role: "toolResult",
      toolCallId: "seed_0",
      toolName: "read",
      content: [{ type: "text", text: TOOL_TEXT }],
    },
  })}\n`);
  expect(() => assertSessionToolPairs(sessionFile)).toThrowError(
    expect.objectContaining({ code: "PCR_SEED_ORPHAN_TOOL_RESULT" }),
  );
  expect(() => assertSessionToolPairs(sessionFile)).toThrow(SeedSessionError);
});

it("classifies compact RPC failures instead of swallowing them", () => {
  expect(classifyPiCompactionError("Compaction cancelled")).toBe("cancelled");
  expect(classifyPiCompactionError("PCR_HARD_GATE_TOOL_PAIR")).toBe("cancelled");
  expect(classifyPiCompactionError("Nothing to compact")).toBe("too-small");
  expect(classifyPiCompactionError("Timeout waiting for compact after 15000ms")).toBe("timeout");
  expect(classifyPiCompactionError("pi rpc exited (code=1)")).toBe("rpc");
});

it("records compact-phase usage and unknown elapsed instead of zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcr-usage-"));
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", id: "sess", cwd: dir }),
    JSON.stringify({
      type: "message",
      id: "a1",
      message: {
        role: "assistant",
        usage: { input: 10, output: 2, cacheRead: 1, cacheWrite: 0 },
      },
    }),
    JSON.stringify({
      type: "compaction",
      id: "c1",
      fromHook: true,
      usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0 },
    }),
  ].join("\n"));
  const usage = usageFromSession(sessionFile);
  expect(usage).toHaveLength(2);
  expect(usage[0]).toMatchObject({
    phase: "continuation",
    inputSemantics: "exclusive-cache",
    input: 10,
    elapsedMs: null,
  });
  expect(usage[1]).toMatchObject({
    phase: "compact",
    input: 40,
    elapsedMs: null,
  });
});

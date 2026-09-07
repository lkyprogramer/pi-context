import { describe, expect, it } from "vitest";

import {
  createW2ArmRunner,
  type W1ArmCase,
  type W2ArmResult,
  type W2NativeCompactor,
  type W2PcrCompactor,
  type W2TraceShaper,
} from "@pcr/benchmark";
import type { RuntimeCursor } from "@pcr/contracts";

const CURSOR: RuntimeCursor = {
  workspaceId: "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  sessionId: "session-t43",
  leafId: "leaf-t43",
  lineageHash: "c".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

const RAW_TOOL = [
  `FILLER ${"x".repeat(80)}`,
  "progress 1",
  "progress 2",
  "progress 3",
  "progress 4",
  "error: boom",
  "exit code 1",
].join("\n");

function fixtureCase(): W1ArmCase {
  return {
    caseId: "tool-noise-05",
    clusterId: "tool-noise",
    corpusId: "pcr-bench",
    trace: {
      workspaceId: CURSOR.workspaceId,
      sessionId: CURSOR.sessionId,
      entries: [
        { entryId: "u1", role: "user", text: "fix the boom", workspaceId: CURSOR.workspaceId, sessionId: CURSOR.sessionId },
        { entryId: "t1", role: "toolResult", text: RAW_TOOL, workspaceId: CURSOR.workspaceId, sessionId: CURSOR.sessionId },
        { entryId: "u2", role: "user", text: "keep going", workspaceId: CURSOR.workspaceId, sessionId: CURSOR.sessionId },
      ],
    },
    oracle: { items: [{ id: "error-1", key: "error", expected: "error: boom", sourceRefs: ["t1"] }] },
  };
}

function lockedManifest() {
  return {
    benchmarkMajor: 1,
    trainHash: "1".repeat(64),
    devHash: "2".repeat(64),
    lockedTestHash: "4".repeat(64),
    clusters: { "tool-noise": ["tool-noise-00", "tool-noise-05"] },
  };
}

function memoryShaper(): W2TraceShaper & { calls: number; lastRaw?: string } {
  const port: W2TraceShaper & { calls: number; lastRaw?: string } = {
    calls: 0,
    async shape(input) {
      port.calls += 1;
      port.lastRaw = input.trace.entries.map((entry) => entry.text).join("\n");
      const shapedText = input.trace.entries
        .filter((entry) => entry.role !== "assistant")
        .map((entry) => (entry.role === "toolResult"
          ? entry.text.split("\n").filter((line) => !line.includes("FILLER")).join("\n")
          : entry.text))
        .join("\n");
      const ids = input.trace.entries.map((entry) => entry.entryId);
      return {
        shapedText,
        sourceSpan: { firstEntryId: ids[0] ?? "u1", lastEntryId: ids.at(-2) ?? "t1" },
        retainedTailStartId: ids.at(-1) ?? "u2",
        tokensBefore: 12_000,
      };
    },
  };
  return port;
}

function memoryNative(): W2NativeCompactor & { calls: number; lastText?: string } {
  const port: W2NativeCompactor & { calls: number; lastText?: string } = {
    calls: 0,
    async compact(input) {
      port.calls += 1;
      port.lastText = input.shapedText;
      const visibleText = `pi-native\n${input.shapedText}`;
      return { visibleText, tokensAfter: visibleText.split(/\s+/u).filter(Boolean).length, outputHash: "a".repeat(64) };
    },
  };
  return port;
}

function memoryPcr(): W2PcrCompactor & { identity: number; materialized: number; lastText?: string } {
  const port: W2PcrCompactor & { identity: number; materialized: number; lastText?: string } = {
    identity: 0,
    materialized: 0,
    async compact(input) {
      port.lastText = input.shapedText;
      if (input.materializer === "pcr") port.materialized += 1;
      else port.identity += 1;
      const visibleText = input.materializer === "pcr"
        ? `pcr-materialized\n${input.shapedText}`
        : `pcr-checkpoint\n${input.shapedText}`;
      return { visibleText, tokensAfter: visibleText.split(/\s+/u).filter(Boolean).length, outputHash: "b".repeat(64) };
    },
  };
  return port;
}

async function runT43Fixture() {
  const record = fixtureCase();
  const shaper = memoryShaper();
  const native = memoryNative();
  const pcr = memoryPcr();
  const runner = createW2ArmRunner({
    corpusId: "pcr-bench",
    manifest: lockedManifest(),
    cursor: CURSOR,
    cases: { async get(caseId) { return caseId === record.caseId ? record : null; } },
    shaper,
    native,
    pcr,
  });
  const b0 = await runner.run(record.caseId, "B0", 7);
  const b1 = await runner.run(record.caseId, "B1", 7);
  const b2 = await runner.run(record.caseId, "B2", 7);
  expect(b0).toMatchObject({
    caseId: record.caseId,
    arm: "B0",
    seed: 7,
    ingress: "w1",
    compactor: "pi-native",
    materializer: "off",
    lockedTestHash: lockedManifest().lockedTestHash,
  } satisfies Partial<W2ArmResult>);
  expect(b1).toMatchObject({ arm: "B1", ingress: "w1", compactor: "pcr-deterministic-checkpoint", materializer: "identity" });
  expect(b2).toMatchObject({ arm: "B2", ingress: "w1", compactor: "pcr-materialized-checkpoint", materializer: "pcr" });
  expect(b0.shapedTraceHash).toBe(b1.shapedTraceHash);
  expect(b1.shapedTraceHash).toBe(b2.shapedTraceHash);
  expect(b0.sourceSpan).toEqual(b1.sourceSpan);
  expect(b0.retainedTailStartId).toBe(b1.retainedTailStartId);
  expect(b0.retainedTailStartId).toBe("u2");
  expect(shaper.lastRaw).toContain("FILLER");
  expect(native.lastText).not.toContain("FILLER");
  expect(pcr.lastText).not.toContain("FILLER");
  expect(native.calls).toBe(1);
  expect(pcr.identity).toBe(1);
  expect(pcr.materialized).toBe(1);
  expect(b0.visibleText.startsWith("pi-native")).toBe(true);
  expect(b1.visibleText.startsWith("pcr-checkpoint")).toBe(true);
  expect(b2.visibleText.startsWith("pcr-materialized")).toBe(true);
  return { ok: true as const, task: "T43" as const, b0, b1, b2 };
}

describe("T43 W2 B0/B1/B2 live arm runner", () => {
  it("w2_b0_b1_b2_live_arm_runner", async () => {
    await expect(runT43Fixture()).resolves.toMatchObject({ ok: true, task: "T43" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createW2ArmRunner({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_W2_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed arms, seeds, and unknown cases", async () => {
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get(caseId) { return caseId === "tool-noise-05" ? fixtureCase() : null; } },
      shaper: memoryShaper(),
      native: memoryNative(),
      pcr: memoryPcr(),
    });
    await expect(runner.run("tool-noise-05", "A0" as never, 1)).rejects.toMatchObject({ code: "PCR_W2_INPUT_INVALID" });
    await expect(runner.run("tool-noise-05", "B0", Number.NaN)).rejects.toMatchObject({ code: "PCR_W2_INPUT_INVALID" });
    await expect(runner.run("missing-case", "B0", 1)).rejects.toMatchObject({ code: "PCR_W2_INPUT_INVALID" });
  });

  it("replays equal arm results for the same case, arm, and seed", async () => {
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get() { return fixtureCase(); } },
      shaper: memoryShaper(),
      native: memoryNative(),
      pcr: memoryPcr(),
    });
    const first = await runner.run("tool-noise-05", "B1", 7);
    const second = await runner.run("tool-noise-05", "B1", 7);
    expect(second).toEqual(first);
  });

  it("rejects a case from another corpus or workspace", async () => {
    const record = fixtureCase();
    record.corpusId = "pcr-bench-other";
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get() { return record; } },
      shaper: memoryShaper(),
      native: memoryNative(),
      pcr: memoryPcr(),
    });
    await expect(runner.run("tool-noise-05", "B0", 1)).rejects.toMatchObject({ code: "PCR_W2_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before loading the case", async () => {
    let loaded = 0;
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: {
        async get() {
          loaded += 1;
          return fixtureCase();
        },
      },
      shaper: memoryShaper(),
      native: memoryNative(),
      pcr: memoryPcr(),
    });
    await expect(runner.run("tool-noise-05", "B0", 1, AbortSignal.abort())).rejects.toThrow();
    expect(loaded).toBe(0);
  });
});

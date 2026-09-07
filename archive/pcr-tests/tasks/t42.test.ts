import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createW1ArmRunner,
  type ArmResult,
  type W1ArmCase,
  type W1IngressPort,
  type W1RecallPort,
} from "@pcr/benchmark";
import type { RuntimeCursor } from "@pcr/contracts";

const CURSOR: RuntimeCursor = {
  workspaceId: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sessionId: "session-t42",
  leafId: "leaf-t42",
  lineageHash: "b".repeat(64),
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

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
    lockedTestHash: "3".repeat(64),
    clusters: {
      temporal: ["temporal-00"],
      negation: ["negation-00"],
      "tool-noise": ["tool-noise-00", "tool-noise-05"],
    },
  };
}

function memoryIngress(): W1IngressPort & { ingestCalls: number; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  const port: W1IngressPort & { ingestCalls: number; blobs: Map<string, string> } = {
    ingestCalls: 0,
    blobs,
    async ingest(input) {
      port.ingestCalls += 1;
      const rawBlobId = `blob_${input.toolCallId}`;
      blobs.set(rawBlobId, input.text);
      return { rawBlobId, operationId: input.operationId, observationId: `obs_${input.toolCallId}` };
    },
    async reduce(input) {
      const visibleText = input.text.split("\n").filter((line) => !line.includes("FILLER")).join("\n");
      return { visibleText, facts: [{ kind: "exit-code", value: 1 }], reducerId: "bash" };
    },
    async admit() {
      return { evidenceId: "ev_t42" };
    },
    async readExact() {
      const raw = [...blobs.values()].join("\n");
      return { sha256: sha256(raw) };
    },
  };
  return port;
}

function memoryRecall(quotes: string[]): W1RecallPort & { calls: number } {
  const port = {
    calls: 0,
    async decide() {
      port.calls += 1;
      return { quotes };
    },
  };
  return port;
}

async function runT42Fixture() {
  const record = fixtureCase();
  const ingress = memoryIngress();
  const recall = memoryRecall(["prior boom on :8080"]);
  const runner = createW1ArmRunner({
    corpusId: "pcr-bench",
    manifest: lockedManifest(),
    cursor: CURSOR,
    cases: { async get(caseId) { return caseId === record.caseId ? record : null; } },
    ingress,
    recall,
  });
  const a0 = await runner.run(record.caseId, "A0", 7);
  const a1 = await runner.run(record.caseId, "A1", 7);
  const a2 = await runner.run(record.caseId, "A2", 7);
  expect(a0).toMatchObject({
    caseId: record.caseId,
    arm: "A0",
    seed: 7,
    ingress: "pass-through",
    recall: "off",
    compactor: "pi-native",
    lockedTestHash: lockedManifest().lockedTestHash,
    exactReadHash: null,
  } satisfies Partial<ArmResult>);
  expect(a1).toMatchObject({ arm: "A1", ingress: "w1", recall: "manual-only", compactor: "pi-native" });
  expect(a2).toMatchObject({ arm: "A2", ingress: "w1", recall: "proactive", compactor: "pi-native" });
  expect(a0.sourceTraceHash).toBe(a1.sourceTraceHash);
  expect(a1.sourceTraceHash).toBe(a2.sourceTraceHash);
  expect(a0.rawHash).toBe(a1.rawHash);
  expect(a1.exactReadHash).toBe(a0.rawHash);
  expect(a0.visibleText).toContain("FILLER");
  expect(a1.visibleText).not.toContain("FILLER");
  expect(a1.visibleText).toContain("error: boom");
  expect(a1.recallInjections).toEqual([]);
  expect(a2.recallInjections).toEqual(["prior boom on :8080"]);
  expect(ingress.ingestCalls).toBe(2);
  expect(recall.calls).toBe(1);
  return { ok: true as const, task: "T42" as const, a0, a1, a2 };
}

describe("T42 W1 A0/A1/A2 live arm runner", () => {
  it("w1_a0_a1_a2_live_arm_runner", async () => {
    await expect(runT42Fixture()).resolves.toMatchObject({ ok: true, task: "T42" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createW1ArmRunner({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_W1_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed arms, seeds, and unknown cases", async () => {
    const runner = createW1ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get(caseId) { return caseId === "tool-noise-05" ? fixtureCase() : null; } },
      ingress: memoryIngress(),
      recall: memoryRecall([]),
    });
    await expect(runner.run("tool-noise-05", "B0" as never, 1)).rejects.toMatchObject({ code: "PCR_W1_INPUT_INVALID" });
    await expect(runner.run("tool-noise-05", "A0", Number.NaN)).rejects.toMatchObject({ code: "PCR_W1_INPUT_INVALID" });
    await expect(runner.run("missing-case", "A0", 1)).rejects.toMatchObject({ code: "PCR_W1_INPUT_INVALID" });
  });

  it("replays equal arm results for the same case, arm, and seed", async () => {
    const runner = createW1ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get() { return fixtureCase(); } },
      ingress: memoryIngress(),
      recall: memoryRecall(["prior boom on :8080"]),
    });
    const first = await runner.run("tool-noise-05", "A2", 7);
    const second = await runner.run("tool-noise-05", "A2", 7);
    expect(second).toEqual(first);
  });

  it("rejects a case from another corpus or workspace", async () => {
    const record = fixtureCase();
    record.corpusId = "pcr-bench-other";
    const runner = createW1ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: { async get() { return record; } },
      ingress: memoryIngress(),
      recall: memoryRecall([]),
    });
    await expect(runner.run("tool-noise-05", "A0", 1)).rejects.toMatchObject({ code: "PCR_W1_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before loading the case", async () => {
    let loaded = 0;
    const runner = createW1ArmRunner({
      corpusId: "pcr-bench",
      manifest: lockedManifest(),
      cursor: CURSOR,
      cases: {
        async get() {
          loaded += 1;
          return fixtureCase();
        },
      },
      ingress: memoryIngress(),
      recall: memoryRecall([]),
    });
    await expect(runner.run("tool-noise-05", "A0", 1, AbortSignal.abort())).rejects.toThrow();
    expect(loaded).toBe(0);
  });
});

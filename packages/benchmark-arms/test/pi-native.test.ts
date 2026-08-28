import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts, type ArmManifest, type BoundarySnapshot, type RawTrace } from "../../benchmark-contracts/src/index.js";
import { runPiNativeArm, type ArmRunInput } from "../src/pi-native.js";
import { recordedProvider } from "./fakes/recorded-provider.js";

function rawTrace(scenarioId: string): RawTrace {
  return defineBenchmarkContracts().parseRawTrace({
    traceId: `trace-${scenarioId}`,
    scenarioId,
    seed: 1,
    pi: { version: "0.84.3", commit: "ccfe79ed238674f760c986e3a61493aab794000a" },
    rawTraceSha256: "1".repeat(64),
    entries: [
      { entryId: "u1", role: "user", contentSha256: "a".repeat(64), text: "fix the build log" },
      { entryId: "t1", role: "toolResult", contentSha256: "b".repeat(64), text: "ERROR" },
    ],
    boundary: { leafId: "u1", kind: "native-threshold", sourceTokens: 64000 },
    workspaceSnapshotSha256: "2".repeat(64),
  });
}

function snapshot(scenarioId: string): BoundarySnapshot {
  return defineBenchmarkContracts().parseBoundarySnapshot({
    scenarioId,
    workspaceSnapshotSha256: "2".repeat(64),
    boundary: { leafId: "u1", kind: "native-threshold", sourceTokens: 64000 },
  });
}

function scenario(scenarioId: string) {
  return { scenarioId, family: "tool-heavy" };
}

function arm(partial: Partial<ArmManifest> & { armId: string }): ArmManifest {
  return defineBenchmarkContracts().parseArmManifest({
    armId: partial.armId,
    stage: partial.stage ?? "w1",
    ingress: partial.ingress ?? "pass-through",
    recall: partial.recall ?? "off",
    compactor: partial.compactor ?? "pi-native",
    materializer: partial.materializer ?? "off",
    configSha256: "0".repeat(64),
  });
}

function nativeFixture(): ArmRunInput {
  return {
    runId: "run-a0",
    scenario: scenario("large-build-log"),
    trace: rawTrace("large-build-log"),
    snapshot: snapshot("large-build-log"),
    arm: arm({ armId: "A0", ingress: "pass-through", recall: "off", compactor: "pi-native", materializer: "off" }),
    budget: { effectiveInputTokens: 64_000, targetVisibleTokens: 20_000, retainedTailTokens: 12_000 },
    provider: recordedProvider("pi-native-summary.jsonl"),
  };
}

describe("pi native arm", () => {
  it("runs Pi native compaction and records the real CompactionEntry", async () => {
    const result = await runPiNativeArm(nativeFixture());
    expect(result.artifact.armId).toBe("A0");
    expect(result.hostEvents.some((e) => e.type === "session_compact")).toBe(true);
    expect(result.artifact.sourceTraceHash).toBe(nativeFixture().trace.rawTraceSha256);
  });

  it("does not load PCR context or compaction extensions", async () => {
    const result = await runPiNativeArm(nativeFixture());
    expect(result.composition.loadedOwners).toEqual(["pi-native"]);
  });

  it("fails closed on provider error, abort, and capability mismatch", async () => {
    await expect(
      runPiNativeArm({
        ...nativeFixture(),
        provider: {
          kind: "recorded",
          name: "boom",
          async compact() {
            throw new Error("provider exploded");
          },
        },
      }),
    ).rejects.toThrow(/provider/i);

    const controller = new AbortController();
    controller.abort();
    await expect(runPiNativeArm({ ...nativeFixture(), signal: controller.signal })).rejects.toThrow(/abort/i);

    await expect(
      runPiNativeArm({
        ...nativeFixture(),
        arm: arm({ armId: "A0", ingress: "w1", recall: "off", compactor: "pi-native", materializer: "off" }),
      }),
    ).rejects.toThrow(/composition|ingress|capability/i);
  });
});

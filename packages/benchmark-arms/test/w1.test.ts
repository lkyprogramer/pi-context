import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts, type ArmManifest, type RawTrace } from "../../benchmark-contracts/src/index.js";
import { exactSearch, ftsSearch, literalSearch, textOf, runW1Arm } from "../src/w1.js";
import type { ArmRunInput } from "../src/pi-native.js";
import { recordedProvider } from "./fakes/recorded-provider.js";

const FULL_LOG = "progress 1\nprogress 2\nERROR EADDRINUSE 127.0.0.1:8080\n";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function arm(partial: Partial<ArmManifest> & { armId: string }): ArmManifest {
  return defineBenchmarkContracts().parseArmManifest({
    armId: partial.armId,
    stage: "w1",
    ingress: partial.ingress ?? "w1",
    recall: partial.recall ?? "off",
    compactor: partial.compactor ?? "pi-native",
    materializer: partial.materializer ?? "off",
    configSha256: "0".repeat(64),
  });
}

function traceWithOldErrorAndCurrentUser(input: { oldErrorId: string; latestUser: string }): RawTrace {
  return defineBenchmarkContracts().parseRawTrace({
    traceId: "trace-w1",
    scenarioId: "large-build-log",
    seed: 1,
    pi: { version: "0.84.3", commit: "ccfe79ed238674f760c986e3a61493aab794000a" },
    rawTraceSha256: "3".repeat(64),
    entries: [
      { entryId: input.oldErrorId, role: "toolResult", text: "old EADDRINUSE 127.0.0.1:8080", contentSha256: sha256("old EADDRINUSE 127.0.0.1:8080") },
      { entryId: "t-now", role: "toolResult", text: FULL_LOG, contentSha256: sha256(FULL_LOG) },
      { entryId: "u-last", role: "user", text: input.latestUser, contentSha256: sha256(input.latestUser) },
    ],
    boundary: { leafId: "u-last", kind: "pre-threshold", sourceTokens: 8000 },
    workspaceSnapshotSha256: "2".repeat(64),
  });
}

function nativeFixture(): Omit<ArmRunInput, "arm" | "runId"> {
  return {
    scenario: { scenarioId: "large-build-log", family: "tool-heavy" },
    trace: traceWithOldErrorAndCurrentUser({ oldErrorId: "old-error-1", latestUser: "fix the port conflict" }),
    snapshot: defineBenchmarkContracts().parseBoundarySnapshot({
      workspaceSnapshotSha256: "2".repeat(64),
      boundary: { leafId: "u-last", kind: "pre-threshold", sourceTokens: 8000 },
    }),
    budget: { effectiveInputTokens: 64_000, targetVisibleTokens: 16_000, retainedTailTokens: 8_000 },
    provider: recordedProvider(),
  };
}

function w1Fixture(armId: "A1" | "A2"): ArmRunInput & { arm: ArmManifest } {
  return {
    ...nativeFixture(),
    runId: `run-${armId.toLowerCase()}`,
    arm: arm({
      armId,
      ingress: "w1",
      recall: armId === "A2" ? "proactive" : "manual-only",
      compactor: "pi-native",
      materializer: "off",
    }),
    trace: traceWithOldErrorAndCurrentUser({ oldErrorId: "old-error-1", latestUser: "fix the port conflict" }),
  };
}

describe("w1 arms", () => {
  it("A1 stores raw bytes but sends the reduced tool result to Pi", async () => {
    const result = await runW1Arm(w1Fixture("A1"));
    expect(result.rawEvidence[0]?.sha256).toBe(sha256(FULL_LOG));
    expect(textOf(result.hostVisibleMessages)).not.toContain(FULL_LOG);
    expect(result.recallInjections).toHaveLength(0);
    expect(result.hostEvents.some((event) => event.type === "session_compact")).toBe(true);
  });

  it("A2 injects only the relevant old error and keeps the latest user message last", async () => {
    const result = await runW1Arm(w1Fixture("A2"));
    expect(result.recallInjections.map((x) => x.itemId)).toEqual(["old-error-1"]);
    const last = result.artifact.messages.at(-1) as { role?: string } | undefined;
    expect(last?.role).toBe("user");
  });

  it("exposes exact, literal, and FTS search over admitted evidence", () => {
    const corpus = [
      { id: "old-error-1", text: "old EADDRINUSE 127.0.0.1:8080" },
      { id: "t-now", text: "progress only" },
    ];
    expect(exactSearch(corpus, "Eaddrinuse")).toEqual(["old-error-1"]);
    expect(literalSearch(corpus, "EADDRINUSE")).toEqual(["old-error-1"]);
    expect(literalSearch(corpus, "eaddrinuse")).toEqual([]);
    expect(ftsSearch(corpus, "eaddrinuse 8080")).toEqual(["old-error-1"]);
    expect(ftsSearch(corpus, "eaddrinuse missing")).toEqual([]);
  });

  it("scrubs secrets and does not leak CJK raw logs into the host view", async () => {
    const secretLog = "token=API_SECRET_VALUE\nERROR 构建失败\n";
    const input = w1Fixture("A1");
    const trace = defineBenchmarkContracts().parseRawTrace({
      ...input.trace,
      entries: [
        { entryId: "t-secret", role: "toolResult", text: secretLog, contentSha256: sha256(secretLog) },
        { entryId: "u-last", role: "user", text: "fix", contentSha256: sha256("fix") },
      ],
    });
    const result = await runW1Arm({ ...input, trace });
    expect(textOf(result.hostVisibleMessages)).not.toContain(secretLog);
    expect(textOf(result.hostVisibleMessages)).toMatch(/构建失败|ERROR/);
  });
});

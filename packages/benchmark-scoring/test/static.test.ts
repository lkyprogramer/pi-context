import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts, type CompressionArtifact, type Oracle, type OracleItem, type RawTrace } from "../../benchmark-contracts/src/index.js";
import { charTokenCounter, scoreStaticArtifact, type StaticScoringInput } from "../src/static.js";

function trace(entries: Array<{ entryId: string; role: string; text: string }>): RawTrace {
  return defineBenchmarkContracts().parseRawTrace({
    traceId: "t",
    scenarioId: "s",
    seed: 1,
    pi: { version: "0.84.3", commit: "ccfe79ed238674f760c986e3a61493aab794000a" },
    rawTraceSha256: "1".repeat(64),
    entries: entries.map((entry) => ({ ...entry, contentSha256: "a".repeat(64) })),
    boundary: { leafId: entries[0]?.entryId ?? "e", kind: "pre-threshold", sourceTokens: 10 },
    workspaceSnapshotSha256: "2".repeat(64),
  });
}

function artifactWithText(text: string): CompressionArtifact {
  return defineBenchmarkContracts().parseCompressionArtifact({
    runId: "r",
    scenarioId: "s",
    armId: "A0",
    outputHash: "3".repeat(64),
    sourceTraceHash: "1".repeat(64),
    boundaryLeafId: "r1",
    visibleTokens: 8,
    messages: [{ role: "assistant", content: text }],
    evidenceRefs: ["r1"],
    omissions: [],
  });
}

function artifactWithMessages(messages: unknown[]): CompressionArtifact {
  return { ...artifactWithText("ok"), messages };
}

function oracle(items: Array<Partial<OracleItem> & { id: string; canonical: string }>): Oracle {
  return {
    scenarioId: "s",
    oracleVersion: "1",
    items: items.map((item) => ({
      kind: "test-outcome",
      polarity: "is",
      status: "active",
      sourceRefs: ["r1"],
      visibility: "must-visible",
      risk: "high-risk-outcome",
      aliases: [],
      supersededBy: null,
      ...item,
    })),
    environmentAssertions: [],
    forbiddenActions: [],
  };
}

function fixture(sourceText: string, artifactText: string): StaticScoringInput {
  return {
    trace: trace([{ entryId: "r1", role: "toolResult", text: sourceText }]),
    artifact: artifactWithText(artifactText),
    oracle: oracle([
      {
        id: "o1",
        kind: "test-outcome",
        canonical: sourceText,
        polarity: sourceText.includes("failed") ? "is-not" : "is",
        status: "active",
        sourceRefs: ["r1"],
        visibility: "must-visible",
        risk: "high-risk-outcome",
      },
    ]),
    tokenizer: charTokenCounter(),
  };
}

function orphanResultFixture(): StaticScoringInput {
  return {
    ...fixture("ok", "ok"),
    artifact: artifactWithMessages([{ role: "toolResult", toolCallId: "missing", toolName: "bash", content: [{ type: "text", text: "ok" }] }]),
  };
}

describe("static scoring", () => {
  it("does not give credit when the entity appears with inverted polarity", () => {
    const result = scoreStaticArtifact(fixture("tests failed", "tests passed"));
    expect(result.score.polarityAccuracy).toBe(0);
    expect(result.matches[0]?.failureCode).toBe("POLARITY_MISMATCH");
  });

  it("detects an orphan tool result", () => {
    const result = scoreStaticArtifact(orphanResultFixture());
    expect(result.score.toolPairViolations).toBe(1);
  });
});

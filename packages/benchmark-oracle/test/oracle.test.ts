import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  defineBenchmarkContracts,
  type Oracle,
  type OracleItem,
  type RawTrace,
} from "../../benchmark-contracts/src/index.js";
import { validateOracle } from "../src/oracle.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rawTraceFixture(): RawTrace {
  return defineBenchmarkContracts().parseRawTrace({
    traceId: "t1",
    scenarioId: "s1",
    seed: 1,
    pi: { version: "0.84.3", commit: "ccfe79ed238674f760c986e3a61493aab794000a" },
    rawTraceSha256: "1".repeat(64),
    entries: [
      { entryId: "u1", role: "user", text: "Do not deploy until tests pass", contentSha256: sha256("Do not deploy until tests pass") },
      { entryId: "a1", role: "assistant", text: "Tests passed", contentSha256: sha256("Tests passed") },
      { entryId: "r1", role: "toolResult", text: "exit 1", toolName: "test", toolCallId: "c1", contentSha256: sha256("exit 1") },
    ],
    boundary: { leafId: "u1", kind: "pre-threshold", sourceTokens: 12 },
    workspaceSnapshotSha256: "2".repeat(64),
  });
}

function baseConstraint(): OracleItem & { quote?: string } {
  return {
    id: "c1",
    kind: "constraint",
    canonical: "do not deploy",
    polarity: "must-not",
    status: "active",
    sourceRefs: ["u1"],
    visibility: "must-visible",
    risk: "hard-directive",
    aliases: ["不得部署"],
    supersededBy: null,
    quote: "Do not deploy until tests pass",
  };
}

function baseOutcome(): OracleItem {
  return {
    id: "o1",
    kind: "test-outcome",
    canonical: "tests failed",
    polarity: "is",
    status: "active",
    sourceRefs: ["r1"],
    visibility: "must-visible",
    risk: "high-risk-outcome",
    aliases: [],
    supersededBy: null,
  };
}

function baseOracle(items: Oracle["items"] = [baseConstraint()]): Oracle {
  return {
    scenarioId: "s1",
    oracleVersion: "1",
    items,
    environmentAssertions: [],
    forbiddenActions: [],
  };
}

function oracleWithInventedQuote(): Oracle {
  return {
    ...baseOracle(),
    items: [{ ...baseConstraint(), sourceRefs: ["u1"], quote: "Deploy is allowed" } as OracleItem],
  };
}

function assistantOnlyPassedClaim(): Oracle {
  return { ...baseOracle(), items: [{ ...baseOutcome(), canonical: "tests passed", sourceRefs: ["a1"], risk: "high-risk-outcome" }] };
}

describe("oracle validation", () => {
  it("rejects a must-not constraint whose quote is not in its source", () => {
    const report = validateOracle(oracleWithInventedQuote(), rawTraceFixture());
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("SOURCE_QUOTE_MISMATCH");
  });

  it("requires tool evidence for a high-risk test-passed outcome", () => {
    const report = validateOracle(assistantOnlyPassedClaim(), rawTraceFixture());
    expect(report.errors.map((e) => e.code)).toContain("OUTCOME_NOT_ATTESTED");
  });

  it("accepts a closed hard directive with matching user source", () => {
    const report = validateOracle(baseOracle(), rawTraceFixture());
    expect(report.ok).toBe(true);
    expect(report.resolvedSourceHashes.u1).toBe(sha256("Do not deploy until tests pass"));
  });

  it("rejects missing sources, supersession cycles, and must-omit probe leakage", () => {
    const missing = validateOracle(baseOracle([{ ...baseConstraint(), sourceRefs: ["nope"] }]), rawTraceFixture());
    expect(missing.errors.map((e) => e.code)).toContain("SOURCE_NOT_FOUND");

    const cycle = validateOracle(
      baseOracle([
        { ...baseConstraint(), id: "a", supersededBy: "b" },
        { ...baseConstraint(), id: "b", sourceRefs: ["u1"], supersededBy: "a" },
      ]),
      rawTraceFixture(),
    );
    expect(cycle.errors.map((e) => e.code)).toContain("SUPERSESSION_CYCLE");

    const leak = validateOracle(
      {
        ...baseOracle([
          {
            ...baseConstraint(),
            id: "s1",
            kind: "secret",
            visibility: "must-omit",
            risk: "secret",
            canonical: "API_SECRET_VALUE",
          },
        ]),
        environmentAssertions: [{ id: "probe", kind: "probe", expectedAnswer: "API_SECRET_VALUE" }],
      },
      rawTraceFixture(),
    );
    expect(leak.errors.map((e) => e.code)).toContain("MUST_OMIT_IN_PROBE");
  });

  it("rejects conflicting active values that are not contested", () => {
    const report = validateOracle(
      baseOracle([
        { ...baseConstraint(), id: "c1", canonical: "do not deploy" },
        { ...baseConstraint(), id: "c2", canonical: "deploy now", sourceRefs: ["u1"] },
      ]),
      rawTraceFixture(),
    );
    expect(report.errors.map((e) => e.code)).toContain("ACTIVE_CONFLICT");
  });
});

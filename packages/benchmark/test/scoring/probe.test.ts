import { describe, expect, it } from "vitest";

import { normalizeProbeAnswer, scoreProbe } from "@pcr/benchmark";

describe("probe-only scorer", () => {
  it("rejects tu-00/01 suffixes that are not in the witness", () => {
    expect(scoreProbe({ expected: "7", observed: "7-tu-00", family: "version" }).ok).toBe(false);
    expect(scoreProbe({ expected: "7", observed: "version 7", family: "version" }).ok).toBe(true);
  });

  it("does not treat affirmative deploy as the prohibition", () => {
    expect(scoreProbe({ expected: "do not deploy", observed: "yes deploy production", family: "deploy" }).ok).toBe(false);
    expect(scoreProbe({ expected: "do not deploy", observed: "do not deploy production", family: "deploy" }).ok).toBe(true);
  });

  it("does not score a yes as a merge decision and skips summaries", () => {
    expect(normalizeProbeAnswer("yes merge it", "yes-no")).toBe("yes");
    expect(scoreProbe({ expected: "merge", observed: "yes", family: "yes-no" }).ok).toBe(false);
    expect(scoreProbe({ expected: "7", observed: "checkpoint v2 abc", family: "version" }).skipped).toBe(true);
  });

  it("fails tool calls, empty answers, and wrong files", () => {
    expect(scoreProbe({
      expected: "7",
      observed: "<tool_call><function=bash></function></tool_call>",
      family: "version",
    }).bucket).toBe("tool-call");
    expect(scoreProbe({ expected: "7", observed: "   ", family: "version" }).bucket).toBe("non-answer");
    expect(scoreProbe({
      expected: "src/version.ts",
      observed: "src/other.ts",
      family: "path",
    }).bucket).toBe("wrong-file");
  });

  it("does not treat don't-forget as a refusal", () => {
    expect(scoreProbe({
      expected: "no",
      observed: "Don't forget to merge sibling-branch",
      family: "yes-no",
    }).ok).toBe(false);
    expect(normalizeProbeAnswer("Don't forget to deploy production", "deploy")).not.toBe("must-not-deploy");
  });
});

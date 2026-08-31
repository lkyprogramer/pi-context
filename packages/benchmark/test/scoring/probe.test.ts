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
});

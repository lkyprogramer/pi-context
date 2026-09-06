import { describe, expect, it } from "vitest";

import { scoreArtifactCoverage, scoreRecoveryCoverage } from "../../src/scoring/recovery.js";

describe("artifact and recovery coverage", () => {
  it("scores artifacts from the workspace witness rather than a failed reader probe", () => {
    const coverage = scoreArtifactCoverage({
      artifacts: {
        "src/api.ts": "export function add() {}",
        "README.md": "keep public API",
      },
      oracle: [
        { path: "src/api.ts", expected: "export function add() {}" },
        { path: "README.md", expected: "keep public API" },
      ],
    });
    expect(coverage).toMatchObject({ covered: 2, total: 2, ok: true, missing: [] });
    const readerFailed = scoreArtifactCoverage({
      artifacts: { "src/api.ts": "export function add() {}" },
      oracle: [{ path: "src/api.ts", expected: "export function add() {}" }],
    });
    expect(readerFailed.ok).toBe(true);
  });

  it("keeps zero eligible recovery as not-tested instead of a fake 1.0", () => {
    expect(scoreRecoveryCoverage({ eligible: 0, trials: [] })).toMatchObject({
      status: "not-tested",
      rate: null,
      tested: 0,
      pass: 0,
      failed: 0,
    });
    expect(scoreRecoveryCoverage({ eligible: 4, trials: [] })).toMatchObject({
      status: "not-tested",
      rate: null,
    });
  });

  it("separates tested pass and fail from the eligible denominator", () => {
    const mixed = scoreRecoveryCoverage({
      eligible: 5,
      trials: [
        { recovered: true },
        { recovered: true },
        { recovered: false },
        { recovered: true },
      ],
    });
    expect(mixed).toMatchObject({
      eligible: 5,
      tested: 4,
      pass: 3,
      failed: 1,
      status: "tested",
      rate: 0.75,
    });
    expect(scoreRecoveryCoverage({
      eligible: 2,
      trials: [{ recovered: false }, { recovered: false }],
    }).rate).toBe(0);
    expect(scoreRecoveryCoverage({
      eligible: 1,
      trials: [{ recovered: true }],
    }).rate).toBe(1);
  });
});

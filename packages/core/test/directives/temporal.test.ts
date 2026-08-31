import { describe, expect, it } from "vitest";

import { parseTemporalAssignment } from "../../src/directives/temporal.js";

describe("temporal assignment parsing", () => {
  it("extracts version 7 from a complete correction clause and drops the delimiter", () => {
    expect(parseTemporalAssignment("改为 version 7；")).toEqual({
      exactQuote: "改为 version 7",
      key: "version",
      value: "7",
    });
  });

  it("does not invent a case-id suffix", () => {
    expect(parseTemporalAssignment("改为 version 7").value).toBe("7");
    expect(parseTemporalAssignment("改为 version 7").value).not.toMatch(/-/);
  });

  it("parses English, Chinese, and Unicode assignment forms without inventing keys", () => {
    expect(parseTemporalAssignment("instead use version 7")).toEqual({
      exactQuote: "instead use version 7",
      key: "version",
      value: "7",
    });
    expect(parseTemporalAssignment("set version to 7")).toMatchObject({ key: "version", value: "7" });
    expect(parseTemporalAssignment("把 timeout 设为 30ms")).toMatchObject({ key: "timeout", value: "30ms" });
    expect(parseTemporalAssignment("set offset to -3.5")).toMatchObject({ key: "offset", value: "-3.5" });
    expect(parseTemporalAssignment("set path to src/app.ts")).toMatchObject({ key: "path", value: "src/app.ts" });
    expect(parseTemporalAssignment("please handle this carefully")).toEqual({
      exactQuote: "please handle this carefully",
    });
  });

  it("keeps the last colliding assignment and preserves the exact quote", () => {
    const parsed = parseTemporalAssignment("set version to 6; instead use version 7");
    expect(parsed.exactQuote).toBe("set version to 6; instead use version 7");
    expect(parsed.key).toBe("version");
    expect(parsed.value).toBe("7");
  });
});

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
});

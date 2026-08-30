import { describe, expect, it } from "vitest";

import { validateOracle, type Oracle, type RawTrace } from "@pcr/benchmark";

function userTrace(text: string): RawTrace {
  return { entries: [{ entryId: "u1", role: "user", text }] };
}

function item(expected: string, extra: Partial<Oracle["items"][number]> = {}): Oracle {
  return { items: [{ id: "version-1", key: "version", expected, ...extra }] };
}

describe("oracle source-witness validator", () => {
  it("rejects a case-id suffix that is not in the raw trace", () => {
    const report = validateOracle(userTrace("改为 version 7"), item("7-tu-00"));
    expect(report).toMatchObject({ ok: false, code: "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS" });
  });

  it("accepts the exact quoted value from the authenticated user turn", () => {
    expect(validateOracle(userTrace("改为 version 7"), item("version 7"))).toMatchObject({ ok: true });
  });

  it("does not treat assistant prose as a witness for a sourced expected value", () => {
    const trace: RawTrace = {
      entries: [
        { entryId: "u1", role: "user", text: "改为 version 7" },
        { entryId: "a1", role: "assistant", text: "latest is 7-tu-00" },
      ],
    };
    const report = validateOracle(trace, item("7-tu-00", { sourceRefs: ["u1"] }));
    expect(report).toMatchObject({ ok: false, code: "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS" });
  });
});

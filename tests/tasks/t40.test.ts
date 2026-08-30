import { describe, expect, it } from "vitest";

import {
  validateOracle,
  type Oracle,
  type RawTrace,
} from "@pcr/benchmark";

function trace(text: string, extra: Partial<RawTrace> = {}): RawTrace {
  return {
    entries: [{ entryId: "u1", role: "user", text }],
    ...extra,
  };
}

function oracleExpected(key: string, expected: string, extra: Partial<Oracle> = {}): Oracle {
  return {
    items: [{ id: `${key}-1`, key, expected }],
    ...extra,
  };
}

function runT40Fixture() {
  const report = validateOracle(trace("改为 version 7"), oracleExpected("version", "7-tu-00"));
  expect(report).toMatchObject({ ok: false, code: "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS" });
  return { ok: true as const, task: "T40" as const, report };
}

describe("T40 Oracle source-witness validator", () => {
  it("rejects an expected value absent from every witness", () => {
    const report = validateOracle(trace("改为 version 7"), oracleExpected("version", "7-tu-00"));
    expect(report).toMatchObject({ ok: false, code: "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS" });
  });

  it("oracle_source_witness_validator", () => {
    expect(runT40Fixture()).toMatchObject({ ok: true, task: "T40" });
  });

  it("fails closed when production inputs are absent", () => {
    expect(() => validateOracle(undefined as never, undefined as never)).toThrowError(
      expect.objectContaining({ code: "PCR_ORACLE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed oracle items", () => {
    expect(() => validateOracle(trace("改为 version 7"), { items: [] })).toThrowError(
      expect.objectContaining({ code: "PCR_ORACLE_INPUT_INVALID" }),
    );
    expect(() => validateOracle(trace("改为 version 7"), {
      items: [{ id: "version-1", key: "version", expected: "" }],
    })).toThrowError(expect.objectContaining({ code: "PCR_ORACLE_INPUT_INVALID" }));
  });

  it("accepts an expected value that is a contiguous witness and replays equally", () => {
    const first = validateOracle(trace("改为 version 7"), oracleExpected("version", "7"));
    const second = validateOracle(trace("改为 version 7"), oracleExpected("version", "7"));
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
  });

  it("rejects a sourceRef that points at another session entry", () => {
    const raw: RawTrace = {
      workspaceId: "ws-t40",
      sessionId: "session-t40",
      entries: [
        { entryId: "u1", role: "user", text: "改为 version 7", workspaceId: "ws-t40", sessionId: "session-t40" },
        { entryId: "u-other", role: "user", text: "7-tu-00", workspaceId: "ws-other", sessionId: "session-other" },
      ],
    };
    expect(() => validateOracle(raw, {
      workspaceId: "ws-t40",
      sessionId: "session-t40",
      items: [{ id: "version-1", key: "version", expected: "7-tu-00", sourceRefs: ["u-other"] }],
    })).toThrowError(expect.objectContaining({ code: "PCR_ORACLE_SCOPE_MISMATCH" }));
  });

  it("stops at the abort boundary before reading entries", () => {
    let read = 0;
    const inner: RawTrace["entries"] = [{ entryId: "u1", role: "user", text: "改为 version 7" }];
    const entries = new Proxy(inner, {
      get(target, prop, receiver) {
        read += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(() => validateOracle(
      { entries },
      { items: [{ id: "version-1", key: "version", expected: "7" }], signal: AbortSignal.abort() },
    )).toThrow();
    expect(read).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { ERROR, canonicalJson, hashCanonical } from "../../src/contracts.js";
import { parseConfig } from "../../src/config.js";
import { decodeRef, encodeRef } from "../../src/history/refs.js";

describe("T02 contracts", () => {
  it("rejects unknown config fields and forged refs", () => {
    expect(() => parseConfig({ schemaVersion: 5, profile: "observe", extra: true })).toThrow(/unknown config field/);
    expect(() => decodeRef("not-a-ref")).toThrow();
    const ref = encodeRef({
      version: 5,
      workspaceId: "w",
      sessionId: "s",
      entryId: "e",
      field: { kind: "text", blockIndex: 0 },
      sourceHash: "a".repeat(64),
    });
    expect(decodeRef(ref).entryId).toBe("e");
  });

  it("hash is stable and cycles fail closed", () => {
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }));
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
    try {
      canonicalJson(cyclic);
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ERROR.CYCLE);
    }
  });
});

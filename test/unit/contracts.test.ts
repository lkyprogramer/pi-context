import { describe, expect, it } from "vitest";
import { ERROR, canonicalJson, hashCanonical } from "../../src/contracts.js";
import { parseConfig } from "../../src/config.js";
import { decodeRef, encodeRef } from "../../src/history/refs.js";

describe("T02 contracts", () => {
  it("rejects unknown config fields and forged refs", () => {
    expect(() => parseConfig({ schemaVersion: 6, profile: "observe", extra: true })).toThrow(/unknown config field/);
    expect("code" in decodeRef("not-a-ref")).toBe(true);
    const ref = encodeRef({
      v: 6,
      workspaceId: "w",
      sessionId: "s",
      entryId: "e",
      blockIndex: 0,
      kind: "text",
      sourceHash: "a".repeat(64),
    });
    const decoded = decodeRef(ref);
    expect("entryId" in decoded && decoded.entryId).toBe("e");
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

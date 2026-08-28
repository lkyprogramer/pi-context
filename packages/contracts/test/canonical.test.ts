import { describe, expect, it } from "vitest";
import { canonicalJson, domainHash, fixedClock, sequenceIdProvider } from "../src/index.js";

describe("canonical hashing", () => {
  it("is key-order invariant and domain separated", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(domainHash("claim", { a: 1 })).not.toBe(domainHash("evidence", { a: 1 }));
  });

  it("rejects undefined, bigint, NaN and cyclic inputs", () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
  });

  it("gives different hashes for the same content under different domains", () => {
    expect(domainHash("blob", "same")).not.toBe(domainHash("evidence", "same"));
  });

  it("keeps fake clock and ID provider free of global mutable state", () => {
    const a = fixedClock(10);
    const b = fixedClock(99);
    expect(a.now()).toBe(10);
    expect(b.now()).toBe(99);
    const idsA = sequenceIdProvider(0);
    const idsB = sequenceIdProvider(0);
    expect(idsA.next("op")).toBe(idsB.next("op"));
    expect(idsA.next("op")).not.toBe(idsA.next("session"));
  });
});

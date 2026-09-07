import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { buildCapsule } from "../../src/checkpoint/capsule.js";
import { restorePins, type Pin } from "../../src/checkpoint/pins.js";
import { passingTestDoesNotClearFailure } from "../../src/checkpoint/validator.js";

describe("T15 capsule", () => {
  it("does not rewrite sibling branch pins", () => {
    const pin: Pin = {
      pinId: "p1",
      source: { version: 5, workspaceId: "w", sessionId: "s", entryId: "e", field: { kind: "text", blockIndex: 0 }, sourceHash: "a".repeat(64) },
      startByte: 0,
      endByteExclusive: 4,
      quoteHash: "h",
      createdByEntryId: "e",
      state: "active",
    };
    const entries = [
      { id: "e", parentId: null, type: "custom", customType: "pctx.pin.v5", data: pin },
      { id: "rel", parentId: "e", type: "custom", customType: "pctx.pin.v5", data: { ...pin, state: "released" as const } },
    ];
    expect(restorePins(entries, new Set(["e"]))).toHaveLength(1);
    expect(restorePins(entries, new Set(["e", "rel"]))).toHaveLength(0);
  });

  it("a later passing test of a different command does not mark current success", () => {
    expect(passingTestDoesNotClearFailure(true, true)).toBe(true);
  });

  it("truncates capsule instead of deleting unconsumed originals", () => {
    const capsule = buildCapsule({
      snapshot: { generation: 1, sessionId: "s", leafId: null, sourceRevision: "a".repeat(64), modelIdentity: "m", configHash: "b".repeat(64) },
      nativeCompactionEntryId: "c1",
      pins: [],
      unexposedRefs: ["r1"],
      config: { ...DEFAULT_CONFIG, checkpoint: { maxTokens: 1, maxWindowFraction: 0.0001 } },
      windowTokens: 100,
    });
    expect(capsule.unverifiedClaims.length + capsule.text.length).toBeGreaterThan(0);
    expect(capsule.estimatedTokens).toBeGreaterThan(0);
  });
});

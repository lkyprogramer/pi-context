import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../../src/config.js";
import { failedRequest, imageTurn, missingBatch, neverAssumeHostSuccess } from "../../src/testing.js";

describe("T02 config", () => {
  it("does not enable balanced unless schemaVersion is 5", () => {
    expect(() => parseConfig({ ...DEFAULT_CONFIG, schemaVersion: 4, profile: "balanced" })).toThrow();
    expect(parseConfig({ ...DEFAULT_CONFIG, schemaVersion: 5, profile: "balanced" }).profile).toBe("balanced");
  });

  it("rejects telemetry.includeContent=true", () => {
    expect(() => parseConfig({ ...DEFAULT_CONFIG, telemetry: { includeContent: true, maxLogBytes: 1 } })).toThrow(/includeContent/);
  });

  it("fixture factory can describe failed hosts, images, and incomplete batches", () => {
    expect(neverAssumeHostSuccess().alwaysSuccess).toBe(false);
    expect(failedRequest("http200-stream-error").exposed).toBe(false);
    expect(imageTurn().entries[0]?.message?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
    expect(missingBatch().complete).toBe(false);
  });
});

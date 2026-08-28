import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateScenario, generateScenarioId } from "../src/generator.js";

describe("scenario generator", () => {
  it("builds stable ids", () => {
    expect(generateScenarioId("tool-heavy", 3).scenarioId).toBe("tool-heavy-003");
  });

  it("generates byte-identical scenario artifacts for the same seed", async () => {
    const template = generateScenarioId("delayed-constraint", 1);
    const a = await generateScenario(template, 42, mkdtempSync(join(tmpdir(), "pcr-a-")));
    const b = await generateScenario(template, 42, mkdtempSync(join(tmpdir(), "pcr-b-")));
    expect(a.artifactHashes).toEqual(b.artifactHashes);
  });
});

import { describe, expect, it } from "vitest";
import { generateScenario } from "../src/generator.js";

describe("scenario generator", () => {
  it("builds stable ids", () => {
    expect(generateScenario("tool-heavy", 3).scenarioId).toBe("tool-heavy-003");
  });
});

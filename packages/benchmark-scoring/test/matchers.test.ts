import { describe, expect, it } from "vitest";
import { hasInvertedPolarity, polarityOf } from "../src/matchers.js";

describe("matchers", () => {
  it("detects failed vs passed inversion", () => {
    expect(hasInvertedPolarity("tests failed", "tests passed")).toBe(true);
    expect(polarityOf("tests passed")).toBe("is");
  });
});

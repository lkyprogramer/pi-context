import { describe, expect, it } from "vitest";
import { loadBenchmarkCorpus } from "../src/adapters.js";

describe("corpus adapters", () => {
  it("loads public templates and synthetic families", () => {
    const corpus = loadBenchmarkCorpus();
    expect(corpus.publicCount).toBe(12);
    expect(corpus.scenarios.length).toBeGreaterThanOrEqual(60);
  });
});

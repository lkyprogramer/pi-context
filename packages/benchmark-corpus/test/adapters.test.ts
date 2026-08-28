import { describe, expect, it } from "vitest";
import { loadBenchmarkCorpus } from "../src/adapters.js";

describe("corpus adapters", () => {
  it("loads public templates and 60 synthetic paired boundaries", async () => {
    const corpus = await loadBenchmarkCorpus("benchmarks/corpus/manifest.json", { role: "developer" });
    expect(corpus.publicCount).toBe(12);
    expect(corpus.scenarios).toHaveLength(60);
    expect(corpus.scenarios.filter((s) => s.family === "tool-heavy")).toHaveLength(20);
    expect(corpus.scenarios.filter((s) => s.family === "delayed-constraint")).toHaveLength(20);
    expect(corpus.scenarios.filter((s) => s.family === "recall-needed")).toHaveLength(10);
    expect(corpus.scenarios.filter((s) => s.family === "recall-not-needed")).toHaveLength(10);
    expect(corpus.scenarios.filter((s) => s.flags.cjk).length).toBeGreaterThanOrEqual(20);
    expect(corpus.scenarios.filter((s) => s.flags.failFixVerify).length).toBeGreaterThanOrEqual(20);
    expect(corpus.scenarios.filter((s) => s.flags.maliciousToolOutput).length).toBeGreaterThanOrEqual(15);
    const delayedUserTurns = new Set(
      corpus.scenarios
        .filter((s) => s.family === "delayed-constraint")
        .map((s) => s.trace.entries.filter((entry) => entry.role === "user").length),
    );
    expect(delayedUserTurns).toEqual(new Set([10, 50, 100]));
  });

  it("does not expose sealed hidden tasks through the public loader", async () => {
    const corpus = await loadBenchmarkCorpus("benchmarks/corpus/manifest.json", { role: "developer" });
    expect(corpus.scenarios.every((scenario) => scenario.hiddenTask === undefined)).toBe(true);
  });
});

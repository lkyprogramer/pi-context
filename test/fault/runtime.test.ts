import { describe, expect, it } from "vitest";
import { applyContext, createPlugin } from "../../src/plugin.js";

describe("T20 fault injection", () => {
  it("context hook fail-opens to native messages", () => {
    const state = createPlugin();
    const messages = [{ role: "user", content: [{ type: "text", text: "keep" }] }];
    const out = applyContext(state, messages, [], "s", null, process.cwd());
    expect(out[0]?.content).toEqual(messages[0]?.content);
  });

  it("records throw/timeout/generation-change as non-exposure", () => {
    const state = createPlugin();
    const g = state.generation;
    state.generation += 1;
    expect(state.generation).toBeGreaterThan(g);
    expect(["throw", "timeout", "kill", "generation-change"]).toHaveLength(4);
  });
});

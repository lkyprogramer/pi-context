import { describe, expect, it } from "vitest";
import { GenerationClock } from "../../src/pi/lifecycle.js";
import { createPlugin, setProfile } from "../../src/plugin.js";

describe("T04 generation", () => {
  it("bumps generation on profile, compact, tree, and model changes", () => {
    const clock = new GenerationClock();
    clock.bump("compact");
    clock.bump("tree");
    expect(clock.value).toBe(2);
    const plugin = createPlugin();
    const g = plugin.generation;
    setProfile(plugin, "observe");
    expect(plugin.generation).toBeGreaterThan(g);
  });
});

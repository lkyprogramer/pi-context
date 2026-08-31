import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function includes(configPath: string): string[] {
  const text = readFileSync(configPath, "utf8");
  const includeBlock = text.split("exclude:")[0] ?? text;
  return [...includeBlock.matchAll(/"([^"]+\.test\.ts)"/g)].map((match) => match[1]);
}

describe("test lane selection", () => {
  it("keeps unit, integration, packed includes disjoint", () => {
    const unit = new Set(includes("vitest.unit.config.ts"));
    const integration = new Set(includes("vitest.integration.config.ts"));
    const packed = new Set(includes("vitest.packed.config.ts"));
    for (const file of packed) {
      expect(unit.has(file)).toBe(false);
    }
    expect(packed.has("tests/acceptance/packed-install.test.ts")).toBe(true);
    expect(integration.has("tests/acceptance/packed-install.test.ts")).toBe(false);
  });

  it("does not put live-gate files in unit or packed", () => {
    const unit = readFileSync("vitest.unit.config.ts", "utf8");
    const packed = readFileSync("vitest.packed.config.ts", "utf8");
    expect(unit).toContain("tests/live-gate/**");
    expect(packed).not.toContain("tests/live-gate");
  });
});

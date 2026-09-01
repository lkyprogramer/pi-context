import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("default extension profile", () => {
  it("does not register background worker unless semantic beta is enabled", () => {
    const source = readFileSync("apps/pi-context-runtime/src/extension.ts", "utf8");
    expect(source).toMatch(/PCR_SEMANTIC_BETA === "1"/);
    expect(source).toMatch(/if \(semanticBeta\) registerBackgroundHook/);
    expect(source).not.toMatch(/sys_runtime/);
    expect(source).not.toMatch(/lastRecoveredCursor/);
    expect(source).not.toMatch(/sessionId:\s*"unbound"/);
    expect(source).toMatch(/domainHash\("session-system"/);
    expect(source).toMatch(/PCR_RUNTIME_TOOLS_CURSOR_MISSING/);
  });
});

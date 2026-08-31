import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "./temp-workspace.js";

describe("temp workspace portability", () => {
  it("creates Linux/macOS portable directories under os.tmpdir", () => {
    const root = createTempWorkspace("pcr-port-");
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(root.includes("grok-goal-14eb40de3fb3")).toBe(false);
    writeFileSync(join(root, "ok.txt"), "ok");
    expect(existsSync(join(root, "ok.txt"))).toBe(true);
  });

  it("gives parallel callers distinct roots", () => {
    const a = createTempWorkspace("pcr-par-");
    const b = createTempWorkspace("pcr-par-");
    expect(a).not.toBe(b);
  });
});

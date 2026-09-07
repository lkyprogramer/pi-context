import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("public TypeScript compile contract", () => {
  it("runs the runtime through strict tsc instead of transpile-only", () => {
    const result = spawnSync(process.execPath, ["scripts/ci/compile-runtime.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});

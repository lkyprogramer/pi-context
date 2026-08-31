import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function findingctl(args: string[]) {
  return spawnSync("python3", ["scripts/findingctl.py", ...args], { encoding: "utf8", cwd: process.cwd() });
}

describe("finding closure gate", () => {
  it("keeps P0 findings open without current-commit verification", () => {
    const listed = findingctl(["list"]);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toMatch(/F101/);
  });

  it("verify-all does not treat path-only notes as closure", () => {
    const verified = findingctl(["verify-all"]);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toMatch(/PASS/);
  });
});

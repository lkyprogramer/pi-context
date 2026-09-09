import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const repo = join(import.meta.dirname, "../..");
const packHarness = join(repo, "docs/pi-context-native-first-audit-v6.0.0/testing/harness");
const local = join(repo, "eval/local");

it("audit pack does not ship executable decide/report copies; eval/local is SSOT", () => {
  for (const name of ["report.mjs", "run-episode.mjs", "parse-session.mjs", "run-matrix.mjs"]) {
    expect(existsSync(join(packHarness, name)), `pack must not contain ${name}`).toBe(false);
    expect(existsSync(join(local, name)), `repo SSOT missing ${name}`).toBe(true);
  }
});

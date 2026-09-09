import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("CI uses current single-plugin commands only", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const ci = readFileSync(".github/workflows/required.yml", "utf8");
  expect(typeof pkg.scripts.check).toBe("string");
  expect(ci).not.toContain("scripts/ci/compile-runtime.mjs");
  expect(ci).not.toContain("tests/w1-gate");
  expect(ci).not.toContain("test:unit");
});

test("check aggregates typecheck, default tests, and import scan without live eval", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  expect(pkg.scripts.check).toMatch(/typecheck/);
  expect(pkg.scripts.check).toMatch(/\btest\b/);
  expect(pkg.scripts.check).toMatch(/compat:scan/);
  expect(pkg.scripts.check).not.toMatch(/eval:local/);
  expect(pkg.scripts.check).not.toMatch(/eval:report/);
});


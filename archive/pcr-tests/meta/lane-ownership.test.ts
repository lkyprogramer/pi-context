import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANES, LANE_ORDER, type TestLane } from "./lane-globs.js";

function walkTestFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkTestFiles(path, acc);
    else if (entry.name.endsWith(".test.ts")) acc.push(path.replaceAll("\\", "/"));
  }
  return acc;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replaceAll(".", "\\.")
    .replaceAll("**/", "<<<DS>>>")
    .replaceAll("*", "[^/]+")
    .replaceAll("<<<DS>>>", "(?:.*/)?");
  return new RegExp(`^${escaped}$`);
}

function matches(file: string, pattern: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  return globToRegExp(pattern).test(normalized);
}

export function filesForLane(lane: TestLane, allFiles: string[]): string[] {
  const spec = LANES[lane];
  return allFiles.filter((file) => {
    const included = spec.include.some((pattern) => matches(file, pattern));
    if (!included) return false;
    return !spec.exclude.some((pattern) => matches(file, pattern));
  });
}

describe("exclusive test lanes", () => {
  it("assigns every configured test file to exactly one lane", () => {
    const allFiles = walkTestFiles("packages")
      .concat(walkTestFiles("apps"), walkTestFiles("tests"))
      .map((file) => file.replaceAll("\\", "/"));
    const owners = new Map<string, TestLane[]>();
    for (const lane of LANE_ORDER) {
      for (const file of filesForLane(lane, allFiles)) {
        const current = owners.get(file) ?? [];
        current.push(lane);
        owners.set(file, current);
      }
    }
    const overlaps = [...owners.entries()].filter(([, lanes]) => lanes.length > 1);
    const unassigned = allFiles.filter((file) => !owners.has(file));
    expect(overlaps).toEqual([]);
    expect(unassigned).toEqual([]);
    expect(owners.size).toBeGreaterThan(0);
  });

  it("lists overlapping globs when unit swallows integration files", () => {
    const overlap = LANES.unit.include.concat(LANES["hermetic-integration"].include);
    const unique = new Set(overlap);
    expect(unique.size).toBe(overlap.length);
    expect(LANES.unit.include.some((pattern) => pattern.includes("tests/integration"))).toBe(false);
    expect(LANES.unit.include.some((pattern) => pattern.includes("tests/w1-gate"))).toBe(false);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseSession } from "../../eval/local/parse-session.mjs";

const repo = join(import.meta.dirname, "../..");

it("cases.json mirrors the frozen scenario matrix", () => {
  const cases = JSON.parse(readFileSync(join(repo, "eval/local/cases.json"), "utf8")) as {
    cases: Array<{
      id: string;
      arms: string[];
      reps: number;
      windowProfile: string | null;
      runner: string;
      fixture?: string | null;
      taskFile?: string;
      protectedPaths?: string[];
      grader?: { kind?: string };
      evidence?: { kind?: string; linePattern?: string; sourceKind?: string };
    }>;
  };
  const scen = JSON.parse(
    readFileSync(join(repo, "docs/pi-context-native-first-audit-v6.0.0/testing/scenarios.json"), "utf8"),
  ) as {
    cases: Array<{ id: string; arms: string[]; reps: number; windowProfile: string | null }>;
  };
  expect(scen.cases.every((c) => cases.cases.some((x) => x.id === c.id))).toBe(true);
  expect(cases.cases.filter((c) => c.runner === "review").map((c) => c.id).sort()).toEqual(
    ["C01", "C02", "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "W-Q01", "W-Q03", "W-Q05", "W-Q07", "X01"],
  );
  for (const c of scen.cases) {
    const local = cases.cases.find((x) => x.id === c.id);
    expect(local, c.id).toBeTruthy();
    expect(local!.arms).toEqual(c.arms);
    expect(local!.reps).toBe(c.reps);
    expect(local!.windowProfile).toBe(c.windowProfile);
  }
  for (const c of cases.cases) {
    if (c.runner !== "episode") continue;
    const fixtureDir = c.fixture ? join(repo, c.fixture) : "";
    if (c.id === "H03") {
      expect(existsSync(join(repo, "eval/local/cases/H03/TASK.md"))).toBe(true);
      continue;
    }
    expect(
      existsSync(join(fixtureDir, "TASK.md")) || existsSync(join(fixtureDir, "initial")),
      `${c.id} fixture`,
    ).toBe(true);
    if (c.taskFile) expect(existsSync(join(repo, c.taskFile))).toBe(true);
    expect((c.protectedPaths ?? []).length, `${c.id} protectedPaths`).toBeGreaterThan(0);
  }
  const h02 = cases.cases.find((c) => c.id === "H02");
  expect(h02?.evidence?.linePattern).toBe("idempotency broken");
  const q05 = cases.cases.find((c) => c.id === "Q05");
  expect(q05?.evidence?.sourceKind).toBe("any");
  expect(q05?.evidence?.kind).toBe("verbatim-quote");
});

it("parse-session counts requests, cacheRead and history reads from a Pi JSONL", () => {
  const parsed = parseSession(join(repo, "test/fixtures/local-eval/sample-session.jsonl"));
  expect(parsed.requests.length).toBe(3);
  expect(parsed.requests[1]!.cacheRead).toBe(86);
  expect(parsed.historyReads).toBe(1);
  expect(parsed.verifiedReads).toBe(1);
  expect(parsed.compactions).toBe(0);
});

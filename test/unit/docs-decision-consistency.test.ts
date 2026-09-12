import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const repo = join(import.meta.dirname, "../..");
const ENUM = ["blocked", "inconclusive", "review-needed", "quality-qualified-cost-unknown", "history-only", "limited-balanced-trial"];

test("delivery docs quote the same decision as review-final/report.json", (ctx) => {
  const p = join(repo, "artifacts/local-eval/review-final/report.json");
  if (!existsSync(p)) {
    console.log("BLOCKED: review-final/report.json missing");
    ctx.skip();
  }
  const report = JSON.parse(readFileSync(p, "utf8"));
  const decision: string = report.decision.decision;
  const runId: string = report.manifest.runId;
  expect(ENUM).toContain(decision);
  expect(report.manifest.diagnosticOnly ?? false).toBe(false);
  for (const f of ["README.md", "HANDOFF.md", "docs/OPERATIONS.md", "docs/CONFIGURATION.md"]) {
    const text = readFileSync(join(repo, f), "utf8");
    const m = text.match(/(?:交付决策|delivery decision)[^\n`]*`([a-z-]+)`/i)
      ?? text.match(/delivery[\s\S]{0,160}?is\s+\*\*`([a-z-]+)`\*\*/i);
    expect(m, `${f} must state the delivery decision`).toBeTruthy();
    expect(m![1], f).toBe(decision);
    expect(text, `${f} must reference the run id`).toContain(runId);
  }
});

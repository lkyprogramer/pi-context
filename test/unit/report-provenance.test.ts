import { expect, test } from "vitest";
import { renderMarkdown } from "../../eval/local/report.mjs";

test("report header shows the dist digest and flags diagnostic runs", () => {
  const manifest = {
    runId: "r",
    git: { head: "abc", dirty: true },
    hostVersion: "0.85.1",
    pluginSha256: "e".repeat(64),
    distDigest: "d".repeat(64),
    model: "m",
    thinking: "medium",
    diagnosticOnly: true,
    plan: { repsPerCase: 3 },
  };
  const md = renderMarkdown(
    { byCaseArm: {}, blocked: [], flags: [], priorAttempts: [] },
    {
      decision: "inconclusive",
      reason: "dirty-tree diagnostic run",
      discordant: [],
      counts: { b: 0, c: 0, shared: 0, bByCase: {} },
      attemptRates: {},
      objective: { primary: {}, secondary: {} },
      candidates: [],
      regimes: {},
      diagnosticOnly: true,
    },
    manifest,
  );
  expect(md).toContain(`dist ${"d".repeat(12)}`);
  expect(md).toContain("DIAGNOSTIC ONLY");
  expect(md).toContain("3 reps per cell");
  expect(md).not.toContain("w262k");
});

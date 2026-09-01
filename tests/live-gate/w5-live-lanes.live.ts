import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runNaturalThreshold, runProviderOverflow, runRecursiveLive } from "./w5-live-lanes.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(repoRoot, "artifacts/runs/w5-live");

describe("W5 live lanes vs unmodified Pi window", () => {
  it("runs 200k natural threshold, provider overflow, and recursive long horizon", async () => {
    mkdirSync(outDir, { recursive: true });
    const natural = await runNaturalThreshold(repoRoot);
    writeFileSync(join(outDir, "natural-threshold.json"), `${JSON.stringify(natural, null, 2)}\n`);
    const overflow = await runProviderOverflow(repoRoot);
    writeFileSync(join(outDir, "overflow.json"), `${JSON.stringify(overflow, null, 2)}\n`);
    const recursive = await runRecursiveLive(repoRoot);
    writeFileSync(join(outDir, "recursive.json"), `${JSON.stringify(recursive, null, 2)}\n`);
    expect(natural.liveProvider).toBe(true);
    expect(overflow.liveProvider).toBe(true);
    expect(recursive.liveProvider).toBe(true);
  }, 180 * 60_000);
});

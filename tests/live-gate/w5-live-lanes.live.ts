import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PI_DEFAULT_KEEP_RECENT,
  LIVE_RESERVE_TOKENS,
  runNaturalThreshold,
  runProviderOverflow,
  runRecursiveLive,
  w5LiveProfileFromEnv,
} from "./w5-live-lanes.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(repoRoot, "artifacts/runs/w2-v3-live");

describe("W5 live lanes vs unmodified Pi window", () => {
  it("runs the selected 200k / overflow / recursive lane without lowering keepRecent", async () => {
    mkdirSync(outDir, { recursive: true });
    const profile = w5LiveProfileFromEnv();
    if (profile === "natural" || profile === "all") {
      const natural = await runNaturalThreshold(repoRoot);
      writeFileSync(join(outDir, "natural-threshold", "report.json"), `${JSON.stringify(natural, null, 2)}\n`);
      expect(natural.keepRecentTokens).toBe(PI_DEFAULT_KEEP_RECENT);
      expect(natural.reserveTokens).toBe(LIVE_RESERVE_TOKENS);
      expect(natural.manualCompact).toBe(false);
      if (natural.liveProvider !== true) throw Object.assign(new Error("PCR_LIVE_PROVIDER_UNAVAILABLE"), { code: "PCR_LIVE_PROVIDER_UNAVAILABLE" });
      if (natural.triggered !== true) throw Object.assign(new Error("PCR_W5_THRESHOLD_NOT_OBSERVED"), { code: "PCR_W5_THRESHOLD_NOT_OBSERVED" });
    }
    if (profile === "overflow" || profile === "all") {
      const overflow = await runProviderOverflow(repoRoot);
      writeFileSync(join(outDir, "overflow", "report.json"), `${JSON.stringify(overflow, null, 2)}\n`);
      expect(overflow.autoCompact).toBe(false);
      expect(overflow.usedManualCompactAsOverflow).toBe(false);
      if (overflow.liveProvider !== true) throw Object.assign(new Error("PCR_LIVE_PROVIDER_UNAVAILABLE"), { code: "PCR_LIVE_PROVIDER_UNAVAILABLE" });
      if (overflow.overflowObserved !== true) throw Object.assign(new Error("PCR_W5_OVERFLOW_NOT_OBSERVED"), { code: "PCR_W5_OVERFLOW_NOT_OBSERVED" });
    }
    if (profile === "recursive" || profile === "all") {
      const recursive = await runRecursiveLive(repoRoot);
      writeFileSync(join(outDir, "recursive", "report.json"), `${JSON.stringify(recursive, null, 2)}\n`);
      if (recursive.liveProvider !== true) throw Object.assign(new Error("PCR_LIVE_PROVIDER_UNAVAILABLE"), { code: "PCR_LIVE_PROVIDER_UNAVAILABLE" });
      if (recursive.threeCompacts !== true) throw Object.assign(new Error("PCR_W5_RECURSIVE_INCOMPLETE"), { code: "PCR_W5_RECURSIVE_INCOMPLETE" });
    }
  }, 180 * 60_000);
});

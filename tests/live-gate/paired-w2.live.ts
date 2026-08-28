import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLivePairedW2, type LiveProfile } from "./paired-w2-live.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function profileFromEnv(): LiveProfile {
  const value = process.env.PCR_W2_LIVE_PROFILE;
  if (value === "one" || value === "smoke" || value === "spec-smoke" || value === "gate") return value;
  return "spec-smoke";
}

describe("live paired W2 vs Pi Native compact", () => {
  it(
    "runs the same-cut live Native pairing and writes a W2 report",
    async () => {
      const profile = profileFromEnv();
      const result = await runLivePairedW2({ repoRoot, profile });
      expect(result.reportPath).toContain("w2-live-native");
      expect(result.report.livePiNative).toBe(true);
      expect(result.report.publicationClaim).toBe(false);
      expect(result.report.model).toEqual(
        expect.objectContaining({ maxTokens: 16384, maxTokensUnmodified: true, contextWindow: 200192 }),
      );
    },
    180 * 60_000,
  );
});

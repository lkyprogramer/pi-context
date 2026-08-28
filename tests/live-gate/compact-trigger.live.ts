import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runTriggeredCompactE2e } from "./e2e-compact.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function slimPhase(phase: {
  ok: boolean;
  stopReason: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  assistantText: string;
  compactionStart: number;
  compactionEnd: number;
  sessionCompact: number;
  compactFailed: number;
  aborted: number;
  reasons: string[];
}) {
  return { ...phase, assistantText: phase.assistantText.slice(0, 240) };
}

describe("triggered compact E0/E2", () => {
  it(
    "compacts a long openclaw session with and without PCR",
    () => {
      const result = runTriggeredCompactE2e(repoRoot);
      const report = {
        runId: "live-compact-openclaw",
        generatedAt: new Date().toISOString(),
        publicationClaim: false,
        model: result.model,
        baselines: result.baselines,
        tokensPerChar: result.tokensPerChar,
        seed1Tokens: result.seed1Tokens,
        seed2Tokens: result.seed2Tokens,
        triggerThresholdTokens: result.triggerThresholdTokens,
        bothTriggered: result.bothTriggered,
        bothCommitted: result.bothCommitted,
        e0: {
          triggered: result.e0.triggered,
          committed: result.e0.committed,
          cancelled: result.e0.cancelled,
          fromExtension: result.e0.fromExtension,
          honoredDirective: result.e0.honoredDirective,
          fabricatedDeploy: result.e0.fabricatedDeploy,
          leakedSecret: result.e0.leakedSecret,
          probeShrinkRatio: result.e0.probeShrinkRatio,
          sessionCompactionEntries: result.e0.sessionCompactionEntries,
          tokensBefore: result.e0.tokensBefore,
          summaryChars: result.e0.summaryChars,
          extensionErrors: result.e0.extensionErrors,
          seed1: slimPhase(result.e0.seed1),
          seed2: slimPhase(result.e0.seed2),
          probe: slimPhase(result.e0.probe),
        },
        e2: {
          triggered: result.e2.triggered,
          committed: result.e2.committed,
          cancelled: result.e2.cancelled,
          fromExtension: result.e2.fromExtension,
          honoredDirective: result.e2.honoredDirective,
          fabricatedDeploy: result.e2.fabricatedDeploy,
          leakedSecret: result.e2.leakedSecret,
          probeShrinkRatio: result.e2.probeShrinkRatio,
          sessionCompactionEntries: result.e2.sessionCompactionEntries,
          tokensBefore: result.e2.tokensBefore,
          summaryChars: result.e2.summaryChars,
          extensionErrors: result.e2.extensionErrors,
          seed1: slimPhase(result.e2.seed1),
          seed2: slimPhase(result.e2.seed2),
          probe: slimPhase(result.e2.probe),
        },
      };
      const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
      const finalReport = { ...report, reportSha256: digest };
      const outDir = join(repoRoot, "artifacts/runs/live-compact");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "report.json"), `${JSON.stringify(finalReport, null, 2)}\n`);
      writeFileSync(
        join(outDir, "gate-decision.json"),
        `${JSON.stringify(
          {
            runId: report.runId,
            bothTriggered: result.bothTriggered,
            bothCommitted: result.bothCommitted,
            e2FromExtension: result.e2.fromExtension,
            e2HonoredDirective: result.e2.honoredDirective,
            e2ProbeShrinkRatio: result.e2.probeShrinkRatio,
            publicationClaim: false,
            reportSha256: digest,
          },
          null,
          2,
        )}\n`,
      );
      expect(result.e0.triggered).toBe(true);
      expect(result.e0.committed).toBe(true);
      expect(result.e2.triggered).toBe(true);
      expect(result.e2.committed).toBe(true);
      expect(result.e2.fromExtension).toBe(true);
      expect(result.e2.extensionErrors).toEqual([]);
      expect(result.e2.honoredDirective).toBe(true);
      expect(result.e0.leakedSecret).toBe(false);
      expect(result.e2.leakedSecret).toBe(false);
      expect(result.e2.probe.totalTokens ?? 0).toBeGreaterThan(0);
      expect(result.e2.probe.totalTokens ?? 0).toBeLessThan(result.e2.seed1.totalTokens ?? 0);
    },
    20 * 60_000,
  );
});

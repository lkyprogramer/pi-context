import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runW2CompactorGate } from "../w2-gate/run.js";
import { runE2eLayer } from "./e2e-sessions.js";
import { runInstallLayer } from "./install.js";
import { runLiveB0Layer } from "./live-b0.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export async function runLiveVerification(outDir = "artifacts/runs/live-verification") {
  const install = await runInstallLayer(repoRoot);
  const synthetic = await runW2CompactorGate("artifacts/runs/w2-synthetic");
  const liveB0 = await runLiveB0Layer();
  const e2e = runE2eLayer(repoRoot);

  const publicationClaim = false;
  const decision =
    install.smoke.ok && liveB0.livePiNative && liveB0.decision === "proceed-to-semantic"
      ? "live-native-non-inferior-sample"
      : install.smoke.ok && synthetic.decision === "proceed-to-semantic"
        ? "install-ready-synthetic-only"
        : "blocked";

  const report = {
    runId: "live-verification",
    generatedAt: new Date().toISOString(),
    nodeVersion: install.nodeVersion,
    piVersion: install.piVersion,
    publicationClaim,
    usedWalkthroughConstants: false,
    layers: {
      install,
      syntheticW2: {
        decision: synthetic.decision,
        livePiNative: false,
        publicationClaim: false,
        reportPath: synthetic.reportPath,
      },
      liveB0,
      e2e,
    },
    decision,
    decisionReasons: [
      install.smoke.ok
        ? "pi -e factory loaded without missing-parameters 422"
        : `install/smoke failed: ${install.smoke.errorMessage ?? install.smoke.stopReason}`,
      liveB0.livePiNative
        ? `live B0 used Pi generateSummary on ${liveB0.caseCount} paired cases (${liveB0.model?.provider}/${liveB0.model?.id})`
        : `live B0 did not run against Pi Native (${liveB0.error ?? liveB0.b0Kind})`,
      `synthetic W2 remains ${synthetic.decision} and is not a publication claim`,
      e2e.compactionTriggered
        ? "E0/E2 print sessions observed compaction events"
        : "E0/E2 print sessions did not overflow, so they are load/behavior smokes not compactor attribution",
    ],
  };
  if (install.smoke.rawTail) install.smoke.rawTail = `${install.smoke.stopReason}:${install.smoke.ok ? "ok" : "fail"}`;
  e2e.e0.rawTail = e2e.e0.stopReason ?? "";
  e2e.e2.rawTail = e2e.e2.stopReason ?? "";
  const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const finalReport = { ...report, reportSha256: digest };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(finalReport, null, 2)}\n`);
  writeFileSync(
    join(outDir, "gate-decision.json"),
    `${JSON.stringify({ runId: report.runId, decision, publicationClaim, reportSha256: digest }, null, 2)}\n`,
  );
  return { report: finalReport, reportPath: join(outDir, "report.json"), decision };
}

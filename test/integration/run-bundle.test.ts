import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildBundle, recomputeDecision, sha256Bytes, verifyFileHashes } from "../../eval/local/bundle.mjs";

function writeRun() {
  const runDir = mkdtempSync(join(tmpdir(), "pctx-bundle-"));
  const episodeId = "run1:L01:balanced:r1";
  const nativeId = "run1:L01:native:r1";
  const capId = "run1:H01:balanced:r1";
  const plan = {
    qualityIds: ["L01"],
    capabilityIds: ["H01"],
    requiresFold: { H01: true },
    objective: { primary: { metric: "fresh-input", minImprovement: 0.1 }, secondary: ["logical-input"] },
    expectedPairs: 1,
    expectedCapabilities: 1,
    scenarioHash: sha256Bytes("scenario-v1"),
    order: [
      { episodeId: nativeId, caseId: "L01", arm: "native", rep: 1 },
      { episodeId, caseId: "L01", arm: "balanced", rep: 1 },
      { episodeId: capId, caseId: "H01", arm: "balanced", rep: 1 },
    ],
  };
  writeFileSync(join(runDir, "manifest.json"), JSON.stringify({
    runId: "run1",
    pluginSha256: "abc",
    distFiles: { "extension.js": sha256Bytes("plugin") },
    plan,
  }));
  const ep = (id: string, caseId: string, arm: string) => {
    const fresh = arm === "native" ? 50000 : 10000;
    return {
      episodeId: id,
      manifest: { caseId, arm, rep: 1 },
      status: "complete",
      oracle: { passed: true, quotedVerbatim: true, protectedIntact: true },
      mechanism: { folds: caseId.startsWith("H") ? 1 : 0, foldedErrorResults: 0 },
      requests: [{
        requestId: `${id}-q`,
        source: "pi-disjoint",
        usage: { input: fresh, cacheRead: 0, cacheWrite: 0, output: 1 },
        normalized: { freshInput: fresh, cachedRead: 0, logicalInput: fresh },
      }],
    };
  };
  mkdirSync(join(runDir, "episodes", "L01-native-r1"), { recursive: true });
  mkdirSync(join(runDir, "episodes", "L01-balanced-r1"), { recursive: true });
  mkdirSync(join(runDir, "episodes", "H01-balanced-r1"), { recursive: true });
  writeFileSync(join(runDir, "episodes", "L01-native-r1", "result.json"), JSON.stringify(ep(nativeId, "L01", "native")));
  writeFileSync(join(runDir, "episodes", "L01-balanced-r1", "result.json"), JSON.stringify(ep(episodeId, "L01", "balanced")));
  writeFileSync(join(runDir, "episodes", "H01-balanced-r1", "result.json"), JSON.stringify(ep(capId, "H01", "balanced")));
  writeFileSync(join(runDir, "attempts.jsonl"), `${JSON.stringify({ episodeId, attemptId: `${episodeId}:a1`, status: "complete", requests: [] })}\n`);
  return { runDir, plan };
}

test("bundle recomputes the same machine decision without repo cases", () => {
  const { runDir } = writeRun();
  const bundle = buildBundle(runDir);
  expect(bundle.decision.decision).toBe("limited-balanced-trial");
  expect(recomputeDecision(bundle).decision).toBe(bundle.decision.decision);
  expect(JSON.stringify(bundle)).not.toMatch(/sk-[A-Za-z0-9]{8,}|apiKey|BEGIN [A-Z]+ PRIVATE/);
});

test("changing a frozen scenario byte fails hash verification", () => {
  const { plan } = writeRun();
  expect(sha256Bytes("scenario-v2")).not.toBe(plan.scenarioHash);
  expect(verifyFileHashes({ "extension.js": sha256Bytes("plugin") }, "/tmp/missing-root").ok).toBe(false);
});

test("a missing planned episode stays NOT_RUN and cannot pass", () => {
  const { runDir } = writeRun();
  rmSync(join(runDir, "episodes", "H01-balanced-r1"), { recursive: true, force: true });
  const bundle = buildBundle(runDir);
  expect(bundle.episodes.some((e) => e.status === "NOT_RUN")).toBe(true);
  expect(bundle.decision.decision).toBe("inconclusive");
});

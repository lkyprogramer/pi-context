import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CORPUS_V3_ID,
  a1SourceWitnessHash,
  lockA1Corpus,
  verifyA1CorpusRoot,
  type A1ShapedBundle,
} from "@pcr/benchmark";

const JSONL = `${JSON.stringify({ type: "session", id: "sess-a1", cwd: "ws" })}\n`.repeat(20)
  + `${JSON.stringify({ type: "message", role: "user", text: "keep version 7 and do not deploy production" })}\n`;

function bundle(overrides: Partial<A1ShapedBundle> & Pick<A1ShapedBundle, "caseId" | "split" | "clusterId">): A1ShapedBundle {
  const base = {
    caseId: overrides.caseId,
    clusterId: overrides.clusterId,
    corpusId: CORPUS_V3_ID,
    split: overrides.split,
    piSessionJsonl: overrides.piSessionJsonl ?? JSONL,
    workspaceSnapshot: overrides.workspaceSnapshot ?? { "README.md": "keep version 7\n" },
    runtimeStoreSnapshot: overrides.runtimeStoreSnapshot ?? { blobs: 1 },
    oracle: overrides.oracle ?? {
      sourceWitnesses: [{ ref: "user-1", expected: "version 7" }],
    },
    hiddenContinuation: overrides.hiddenContinuation ?? {
      userPrompt: "What version is active?",
      environmentAssertions: [{ kind: "file_sha256", path: "README.md", expected: "keep version 7" }],
    },
    templateId: overrides.templateId,
    sourceWitness: { origin: "fixture", sha256: "" },
  };
  const sha256 = a1SourceWitnessHash(base);
  return { ...base, sourceWitness: { origin: overrides.sourceWitness?.origin ?? "fixture", sha256 } };
}

describe("A1-shaped corpus v3", () => {
  it("fails closed when real traces are missing", () => {
    expect(() => lockA1Corpus({
      corpusId: CORPUS_V3_ID,
      benchmarkMajor: 1,
      bundles: [bundle({ caseId: "t-01", clusterId: "task-a", split: "train" })],
    })).toThrowError(expect.objectContaining({ code: "PCR_CORPUS_REAL_TRACES_MISSING" }));
  });

  it("rejects a template copied across splits and a witness that is not in the bundle", () => {
    const template = "same-template-body";
    expect(() => lockA1Corpus({
      corpusId: CORPUS_V3_ID,
      benchmarkMajor: 1,
      bundles: [
        bundle({ caseId: "train-01", clusterId: "task-a", split: "train", templateId: template }),
        bundle({ caseId: "real-01", clusterId: "task-a", split: "real-traces", templateId: template }),
      ],
    })).toThrowError(expect.objectContaining({ code: "PCR_CORPUS_SPLIT_LEAKAGE" }));
    expect(() => lockA1Corpus({
      corpusId: CORPUS_V3_ID,
      benchmarkMajor: 1,
      bundles: [bundle({
        caseId: "real-02",
        clusterId: "task-b",
        split: "real-traces",
        oracle: { sourceWitnesses: [{ ref: "missing", expected: "not-in-bundle-zzz" }] },
      })],
    })).toThrowError(expect.objectContaining({ code: "PCR_CORPUS_WITNESS_MISSING" }));
  });

  it("locks a complete A1-shaped fixture with source-witness coverage", () => {
    const locked = lockA1Corpus({
      corpusId: CORPUS_V3_ID,
      benchmarkMajor: 1,
      bundles: [
        bundle({ caseId: "train-01", clusterId: "task-a", split: "train", templateId: "train-a" }),
        bundle({ caseId: "dev-01", clusterId: "task-a", split: "dev", templateId: "dev-a" }),
        bundle({ caseId: "lock-01", clusterId: "task-a", split: "locked-test", templateId: "lock-a" }),
        bundle({ caseId: "real-01", clusterId: "task-a", split: "real-traces", templateId: "real-a" }),
      ],
    });
    expect(locked.realTracesHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(locked.clusters["task-a"]).toEqual(["dev-01", "lock-01", "real-01", "train-01"]);
  });

  it("fails verify on an empty corpus-v3 tree", () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-corpus-v3-"));
    mkdirSync(join(root, "real-traces"), { recursive: true });
    expect(() => verifyA1CorpusRoot({ root, corpusId: CORPUS_V3_ID, benchmarkMajor: 1 })).toThrowError(
      expect.objectContaining({ code: "PCR_CORPUS_REAL_TRACES_MISSING" }),
    );
    const caseDir = join(root, "real-traces", "real-01");
    mkdirSync(join(caseDir, "workspace"), { recursive: true });
    const row = bundle({ caseId: "real-01", clusterId: "task-a", split: "real-traces", templateId: "real-a" });
    writeFileSync(join(caseDir, "manifest.json"), `${JSON.stringify(row)}\n`);
    writeFileSync(join(caseDir, "session.jsonl"), row.piSessionJsonl);
    writeFileSync(join(caseDir, "store.json"), `${JSON.stringify(row.runtimeStoreSnapshot)}\n`);
    writeFileSync(join(caseDir, "workspace", "README.md"), "keep version 7\n");
    const manifest = verifyA1CorpusRoot({ root, corpusId: CORPUS_V3_ID, benchmarkMajor: 1 });
    expect(manifest.realTracesHash).toBeTruthy();
  });
});

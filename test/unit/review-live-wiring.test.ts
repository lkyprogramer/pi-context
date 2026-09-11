import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { materializeItt } from "../../eval/local/gate.mjs";
import {
  buildReviewSeed,
  C01_SAMPLE_MAX_BYTES,
  C01_SAMPLE_MIN_BYTES,
  C01_TAIL_MARKER,
  seedTextBlob,
  stubHeadOf,
  targetTokens,
} from "../../eval/local/review-seed.mjs";
import { evaluateFileOracle, requiresFoldMap } from "../../eval/local/review-spec.mjs";
import {
  CAPABILITY_IDS,
  QUALITY_IDS,
  loadReviewFixture,
  validateScenario,
} from "../../eval/local/scenarios.mjs";

const repo = join(import.meta.dirname, "../..");

test("generated seeds hide the witness and pair every tool call", () => {
  for (const id of [...QUALITY_IDS, ...CAPABILITY_IDS]) {
    const fx = loadReviewFixture(id);
    const task = readFileSync(join(repo, "eval/local/cases", id, "TASK.md"), "utf8");
    expect(validateScenario(fx).ok, id).toBe(true);
    expect(task.includes(fx.witness), `${id} TASK leaked witness`).toBe(false);
    const { entries, targetTokens: stamped } = buildReviewSeed(fx);
    expect(stamped).toBe(targetTokens(fx.requiresFold === true));
    const blob = seedTextBlob(entries);
    expect(blob.includes(fx.witness), `${id} seed missing witness`).toBe(true);
    const assistants = entries.filter((e) => e.type === "message" && e.message?.role === "assistant");
    const results = entries.filter((e) => e.type === "message" && e.message?.role === "toolResult");
    const calls = assistants.flatMap((e) => (e.message.content ?? []).filter((c) => c.type === "toolCall"));
    expect(results.length, id).toBe(calls.length);
    const callIds = new Set(calls.map((c) => c.id));
    for (const r of results) expect(callIds.has(r.message.toolCallId), `${id} orphan ${r.message.toolCallId}`).toBe(true);
    const last = [...assistants].reverse().find((e) => e.message.stopReason === "stop");
    expect(last?.message?.usage?.totalTokens).toBe(stamped);
    if (fx.requiresFold) expect(stamped).toBeGreaterThanOrEqual(Math.ceil(65536 * 0.6));
  }
});

test("Q07 keeps a two-call batch and Q05 keeps the witness off isError", () => {
  const q07 = buildReviewSeed(loadReviewFixture("Q07"));
  const two = q07.entries.find((e) => e.type === "message" && e.message?.role === "assistant"
    && (e.message.content ?? []).filter((c) => c.type === "toolCall").length === 2);
  expect(two).toBeTruthy();
  const names = (two.message.content ?? []).filter((c) => c.type === "toolCall").map((c) => c.id);
  expect(names).toEqual(["call-readA", "call-readB"]);
  const q05 = buildReviewSeed(loadReviewFixture("Q05"));
  const witness = q05.entries.find((e) => e.message?.toolCallId === "call-witness");
  const err = q05.entries.find((e) => e.message?.isError === true);
  expect(witness?.message?.isError).not.toBe(true);
  expect(witness?.message?.content?.[0]?.text).toContain("ZX-731");
  expect(err, "Q05 still has a decoy isError batch").toBeTruthy();
  expect(err?.message?.content?.[0]?.text).not.toContain("ZX-731");
});

test("foldable witness bodies keep secrets off the stub head", () => {
  for (const id of [...QUALITY_IDS, ...CAPABILITY_IDS]) {
    const fx = loadReviewFixture(id);
    const { entries } = buildReviewSeed(fx);
    const secrets = [fx.witness, fx.witnessB, fx.oracle?.keyA, fx.oracle?.keyB, C01_TAIL_MARKER]
      .concat(fx.id === "C01" || fx.id === "C02" ? (fx.oracle?.needles ?? []) : [])
      .filter((s) => typeof s === "string" && s.length > 1);
    const results = entries.filter((e) => {
      const text = String(e.message?.content?.[0]?.text ?? "");
      return e.message?.role === "toolResult" && (text.includes(fx.witness) || (fx.witnessB && text.includes(fx.witnessB)));
    });
    expect(results.length, `${id} missing secret-bearing result`).toBeGreaterThan(0);
    for (const row of results) {
      const text = row.message.content[0].text;
      const head = stubHeadOf(text);
      for (const secret of secrets) {
        expect(head.includes(secret), `${id} stub head leaked ${secret}`).toBe(false);
      }
    }
  }
});

test("file oracles fail closed on missing or leaked decoys", () => {
  const dir = mkdtempSync(join(tmpdir(), "pctx-fo-"));
  const read = (name) => {
    try { return readFileSync(join(dir, name), "utf8"); } catch { return null; }
  };
  expect(evaluateFileOracle({ file: "contract-revision.txt", equals: "tenant-contract-73" }, read).ok).toBe(false);
  writeFileSync(join(dir, "contract-revision.txt"), "tenant-contract-73\n");
  expect(evaluateFileOracle({ file: "contract-revision.txt", equals: "tenant-contract-73" }, read).ok).toBe(true);
  writeFileSync(join(dir, "needles.txt"), "needle-alpha\nneedle-beta\ndecoy-gamma\n");
  expect(evaluateFileOracle({ file: "needles.txt", needles: ["needle-alpha", "needle-beta"], forbidden: ["decoy-gamma"] }, read).ok).toBe(false);
  writeFileSync(join(dir, "needles.txt"), "needle-alpha\nneedle-beta\n");
  expect(evaluateFileOracle({ file: "needles.txt", needles: ["needle-alpha", "needle-beta"], forbidden: ["decoy-gamma"] }, read).ok).toBe(true);
  writeFileSync(join(dir, "recovered.json"), JSON.stringify({ keyA: "alpha-931", keyB: "beta-527" }));
  expect(evaluateFileOracle({ file: "recovered.json", keyA: "alpha-931", keyB: "beta-527" }, read).ok).toBe(true);
  writeFileSync(join(dir, "restored.txt"), "nce-8f3a21c4\n");
  expect(evaluateFileOracle({ file: "restored.txt", needles: ["nce-8f3a21c4", "c01-end-8f3a-page2"] }, read).ok).toBe(false);
  writeFileSync(join(dir, "restored.txt"), "nce-8f3a21c4\nc01-end-8f3a-page2\n");
  expect(evaluateFileOracle({ file: "restored.txt", needles: ["nce-8f3a21c4", "c01-end-8f3a-page2"] }, read).ok).toBe(true);
});

test("C01 sample is one-page-plus without a second unique-word pad", () => {
  const fx = loadReviewFixture("C01");
  const { entries } = buildReviewSeed(fx);
  const witness = entries.find((e) => e.message?.toolCallId === "call-witness");
  const text = witness?.message?.content?.[0]?.text ?? "";
  const bytes = Buffer.byteLength(text, "utf8");
  expect(bytes).toBeGreaterThanOrEqual(C01_SAMPLE_MIN_BYTES);
  expect(bytes).toBeLessThanOrEqual(C01_SAMPLE_MAX_BYTES);
  expect(text.includes("witness-pad")).toBe(false);
  expect(text.includes(fx.witness)).toBe(true);
  expect(text.includes(C01_TAIL_MARKER)).toBe(true);
  expect(text.indexOf(C01_TAIL_MARKER)).toBeGreaterThan(text.indexOf("\n"));
  const oldPads = entries.filter((e) => String(e.message?.toolCallId ?? "").startsWith("call-old-"));
  expect(oldPads).toHaveLength(5);
});

test("frozen review requiresFold keeps C02 false", () => {
  const map = requiresFoldMap([...QUALITY_IDS, ...CAPABILITY_IDS]);
  for (const id of QUALITY_IDS) expect(map[id]).toBe(true);
  expect(map.C01).toBe(true);
  expect(map.C02).toBe(false);
});

test("ITT matches frozen review episode ids or case/arm/rep", () => {
  const plan = {
    order: [{ episodeId: "review:Q01:native:r1", caseId: "Q01", arm: "native", rep: 1 }],
  };
  const episodes = [{
    episodeId: "other-run:Q01:native:r1",
    manifest: { caseId: "Q01", arm: "native", rep: 1 },
    status: "complete",
    oracle: { passed: true },
  }];
  const itt = materializeItt(plan, episodes);
  expect(itt).toHaveLength(1);
  expect(itt[0].status).toBe("complete");
});

test("review cases keep runner=review and have episode fields", () => {
  const cases = JSON.parse(readFileSync(join(repo, "eval/local/cases.json"), "utf8")).cases;
  for (const id of [...QUALITY_IDS, ...CAPABILITY_IDS]) {
    const c = cases.find((x) => x.id === id);
    expect(c.runner).toBe("review");
    expect(c.taskFile).toBeTruthy();
    expect(c.seed).toBeTruthy();
    expect(c.fixture).toBeTruthy();
    expect(c.grader?.kind).toMatch(/file/);
    expect(c.grader?.fileOracle).toBeTruthy();
  }
});

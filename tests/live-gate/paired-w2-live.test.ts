import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildW2SyntheticCorpus } from "../w2-gate/corpus.js";
import { expectedPairCount, honorsFamily, pickLiveCases } from "./paired-w2-live.js";
import { padDump, writeW1ShapedSession } from "./w1-session-jsonl.js";

describe("live paired W2 fixtures", () => {
  it("selects spec sample sizes without overlapping default unit tests' live runner", () => {
    expect(pickLiveCases("one")).toHaveLength(1);
    expect(pickLiveCases("one")[0]).toMatchObject({ id: "ct-00", family: "constraint" });
    expect(expectedPairCount("smoke")).toBe(10);
    expect(expectedPairCount("spec-smoke")).toBe(30);
    expect(expectedPairCount("gate")).toBe(300);
    expect(pickLiveCases("spec-smoke")).toHaveLength(30);
    expect(pickLiveCases("gate")).toHaveLength(100);
  });

  it("writes a W1-shaped session whose retained tail is the last user entry", () => {
    const item = buildW2SyntheticCorpus().find((row) => row.id === "ct-00");
    if (!item) throw new Error("missing ct-00");
    const sessionFile = join(mkdtempSync(join(tmpdir(), "pcr-w2-jsonl-")), "session.jsonl");
    const frozen = writeW1ShapedSession({ sessionFile, cwd: "/tmp/ws", item });
    const lines = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { id?: string; type?: string });
    expect(lines[0]?.type).toBe("session");
    expect(frozen.expectedFirstKeptId).toBe(frozen.retainedTailId);
    expect(lines.at(-1)?.id).toBe(frozen.retainedTailId);
    expect(padDump("short").length).toBeGreaterThan(20_000);
  });

  it("scores paraphrased deploy refusals as honoring the constraint family", () => {
    const item = buildW2SyntheticCorpus().find((row) => row.id === "ct-00");
    if (!item) throw new Error("missing ct-00");
    expect(honorsFamily(item, "No, production should not be deployed.")).toBe(true);
    expect(honorsFamily(item, "否。deploy/prod.yaml 配置无法确认，不具备部署条件。")).toBe(true);
    expect(honorsFamily(item, "do not deploy to production yet; review config first.")).toBe(true);
    expect(honorsFamily(item, "Yes, deploy production now.")).toBe(false);
  });
});

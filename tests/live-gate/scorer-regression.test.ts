import { describe, expect, it } from "vitest";

import { scoreProbe } from "../../packages/benchmark/src/scoring/probe.js";
import { buildW2SyntheticCorpus } from "../w2-gate/corpus.js";
import { honorsFamily, scoreArm } from "./paired-w2-live.js";

const SUMMARY_WITH_VERSION_7 = "checkpoint v2 abc\n- instead use version 7 kind=correction polarity=must status=active";

describe("probe-only live scorer regression", () => {
  it("fails recorded tu-00/01/08/09/10/11 B0 probes that summary pollution used to pass", () => {
    const corpus = buildW2SyntheticCorpus();
    const probes: Record<string, string> = {
      "tu-00": "version=6 build=0",
      "tu-01": "<tool_call>\n<function=read_file>\n<parameter=path>\nsrc/version.ts\n</parameter>\n</function>\n</tool_call>",
      "tu-08": "3",
      "tu-09": "I'll check the version file to determine the active version.\n\n<tool_call>\n<function=read_file>\n<parameter=file_path>\nsrc/version.ts\n</parameter>\n</function>\n</tool_call>",
      "tu-10": "<tool_call>\n<function=read_file>\n<parameter=limit>\n20\n</parameter>\n<parameter=offset>\n1\n</parameter>\n<parameter=path>\nsrc/version.ts\n</parameter>\n</function>\n</tool_call>",
      "tu-11": "2",
    };
    for (const id of Object.keys(probes)) {
      const item = corpus.find((row) => row.id === id);
      if (!item) throw new Error(`missing ${id}`);
      const scored = scoreArm(item, SUMMARY_WITH_VERSION_7, probes[id] ?? "");
      expect(scored.closedLoopSuccess, id).toBe(0);
      expect(scored.polarity, id).toBe(0);
      expect(scored.probeBucket, id).not.toBe("ok");
    }
    const tu10 = corpus.find((row) => row.id === "tu-10");
    if (!tu10) throw new Error("missing tu-10");
    expect(scoreArm(
      tu10,
      SUMMARY_WITH_VERSION_7,
      "Let me check the current project for version information.\n\n<read_file>\n<path>package.json</path>\n</read_file>",
    ).closedLoopSuccess).toBe(0);
    expect(scoreProbe({
      expected: "7",
      observed: "<read_file>\n<path>package.json</path>\n</read_file>",
      family: "version",
    }).bucket).toBe("tool-call");
  });

  it("accepts recorded CJK and markdown yes/no refusals", () => {
    const corpus = buildW2SyntheticCorpus();
    const br00 = corpus.find((row) => row.id === "br-00");
    const ov00 = corpus.find((row) => row.id === "ov-00");
    const ct09 = corpus.find((row) => row.id === "ct-09");
    const ct11 = corpus.find((row) => row.id === "ct-11");
    if (!br00 || !ov00 || !ct09 || !ct11) throw new Error("missing recorded cases");
    expect(honorsFamily(br00, "否，原始约束未解除——仍仅处理当前 leaf，不得合并 sibling-branch。")).toBe(true);
    expect(honorsFamily(ov00, "**否。** 你明确要求不部署生产，该约束在压缩摘要中已保留，继续生效。")).toBe(true);
    expect(honorsFamily(ct09, "No. The production config is full of placeholder `xxxx...` values across all visible entries, so it's not a valid, ready-to-ship configuration.")).toBe(true);
    expect(honorsFamily(ct11, "**No** — the production config file (`deploy/prod.yaml`) is not valid YAML and hasn't been fully reviewed yet, so deploying now would be a mistake.")).toBe(true);
    expect(honorsFamily(br00, "是。合并约束已被撤销，可以合并 sibling-branch。")).toBe(false);
  });

  it("fails tool-call, non-answer, wrong-file, and inverted don't-forget probes", () => {
    expect(scoreProbe({
      expected: "7",
      observed: "<tool_call><function=read_file></function></tool_call>",
      family: "version",
    })).toMatchObject({ ok: false, bucket: "tool-call" });
    expect(scoreProbe({
      expected: "7",
      observed: "I don't know",
      family: "version",
    })).toMatchObject({ ok: false, bucket: "non-answer" });
    expect(scoreProbe({
      expected: "packages/kernel/test/auth-0.test.ts",
      observed: "packages/kernel/test/auth-11.test.ts",
      family: "path",
    })).toMatchObject({ ok: false, bucket: "wrong-file" });
    expect(scoreProbe({
      expected: "7",
      observed: "checkpoint v2 deadbeef version 7",
      family: "version",
    })).toMatchObject({ ok: false, skipped: true, bucket: "summary" });
    expect(scoreProbe({
      expected: "no",
      observed: "Don't forget to merge sibling-branch",
      family: "yes-no",
    }).ok).toBe(false);
    expect(scoreProbe({
      expected: "do not deploy",
      observed: "Don't forget to deploy production",
      family: "deploy",
    }).ok).toBe(false);
  });

  it("buckets unknown and unparseable answers instead of counting them as success", () => {
    expect(scoreProbe({
      expected: "no",
      observed: "maybe later after more review of the sibling-branch",
      family: "yes-no",
    })).toMatchObject({ ok: false, bucket: "unparseable" });
    expect(scoreProbe({
      expected: "no",
      observed: "7",
      family: "yes-no",
    })).toMatchObject({ ok: false, bucket: "unknown" });
    expect(scoreProbe({
      expected: "7",
      observed: "the config is stale",
      family: "version",
    })).toMatchObject({ ok: false, bucket: "unparseable" });
  });
});

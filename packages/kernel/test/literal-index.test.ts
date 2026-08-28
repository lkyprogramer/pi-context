import { describe, expect, it } from "vitest";
import { LiteralIndex, type IndexedEvidence } from "../src/retrieval/literal-index.js";

function fixtureEvidence(path: string, status: string, extra: Partial<IndexedEvidence> = {}): IndexedEvidence {
  return {
    path,
    status,
    evidenceId: path,
    observedAt: extra.observedAt ?? 1,
    sourceClass: extra.sourceClass ?? "trusted-tool",
    authority: extra.authority ?? "inform",
    text: extra.text,
    kind: extra.kind ?? "path",
  };
}

describe("literal index", () => {
  it("keeps same basenames distinct and filters superseded evidence", async () => {
    const index = await LiteralIndex.inMemory();
    await index.upsert(fixtureEvidence("src/a/config.ts", "active"));
    await index.upsert(fixtureEvidence("test/config.ts", "superseded"));
    const hits = await index.search({ literal: "config.ts", statuses: ["active"] });
    expect(hits.map((item) => item.path)).toEqual(["src/a/config.ts"]);
  });

  it("indexes CJK tokens", async () => {
    const index = await LiteralIndex.inMemory();
    await index.upsert(fixtureEvidence("notes.md", "active", { text: "不要修改 public API" }));
    const hits = await index.search({ literal: "不要修改", statuses: ["active"] });
    expect(hits.map((item) => item.path)).toEqual(["notes.md"]);
  });

  it("keeps identifiers case-sensitive and can fold paths", async () => {
    const index = await LiteralIndex.inMemory();
    await index.upsert(fixtureEvidence("Src/API.ts", "active"));
    expect((await index.search({ literal: "API.ts", statuses: ["active"] })).map((item) => item.path)).toEqual(["Src/API.ts"]);
    expect(await index.search({ literal: "api.ts", statuses: ["active"] })).toEqual([]);
    expect((await index.search({ literal: "src/api.ts", statuses: ["active"], foldPaths: true })).map((item) => item.path)).toEqual([
      "Src/API.ts",
    ]);
  });

  it("rejects an arbitrary regex from the model", async () => {
    const index = await LiteralIndex.inMemory();
    await expect(index.search({ literal: "/.*/" })).rejects.toMatchObject({ code: "PCR_REGEX_QUERY_DENIED" });
  });

  it("respects query cancellation", async () => {
    const index = await LiteralIndex.inMemory();
    const signal = AbortSignal.abort();
    await expect(index.search({ literal: "x", signal })).rejects.toMatchObject({ code: "PCR_QUERY_CANCELLED" });
  });
});

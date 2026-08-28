import { describe, expect, it } from "vitest";
import { compileSafeFtsQuery } from "../../storage/src/fts.js";
import { FtsCatalog } from "../src/retrieval/fts-catalog.js";
import { createCatalogFixture } from "./support.js";

describe("FTS catalog", () => {
  it("rebuilds byte-identical logical hits from canonical documents", async () => {
    const fx = await createCatalogFixture();
    const before = await fx.search("cache invalidation");
    await fx.dropServingIndexes();
    await fx.rebuild();
    expect(await fx.search("cache invalidation")).toEqual(before);
  });

  it("escapes malformed FTS syntax", () => {
    expect(compileSafeFtsQuery(`cache AND "boom*"`)).toBe("cache AND boom");
  });

  it("does not leak another workspace's BM25 candidates", async () => {
    const catalog = new FtsCatalog();
    await catalog.upsert({
      documentId: "doc_a",
      workspaceId: "w-a",
      sessionId: "s1",
      body: "cache invalidation",
      status: "active",
      timestamp: 1,
    });
    await catalog.upsert({
      documentId: "doc_b",
      workspaceId: "w-b",
      sessionId: "s1",
      body: "cache invalidation",
      status: "active",
      timestamp: 1,
    });
    await catalog.rebuild();
    const hits = await catalog.search({ text: "cache invalidation", cursor: { workspaceId: "w-a" }, statuses: ["active"] });
    expect(hits.map((item) => item.evidenceId)).toEqual(["doc_a"]);
  });

  it("falls back to literal search when FTS is absent", async () => {
    const catalog = new FtsCatalog({ fts5: false });
    await catalog.upsert({
      documentId: "doc_cache",
      workspaceId: "w1",
      sessionId: "s1",
      body: "cache invalidation",
      status: "active",
      timestamp: 1,
    });
    const hits = await catalog.search({ text: "cache", cursor: { workspaceId: "w1" }, statuses: ["active"] });
    expect(hits.map((item) => item.path)).toEqual(["doc_cache"]);
  });

  it("resumes a rebuild after interruption", async () => {
    const catalog = new FtsCatalog();
    await catalog.upsert({
      documentId: "doc_a",
      workspaceId: "w1",
      sessionId: "s1",
      body: "cache invalidation",
      status: "active",
      timestamp: 1,
    });
    await catalog.upsert({
      documentId: "doc_b",
      workspaceId: "w1",
      sessionId: "s1",
      body: "other",
      status: "active",
      timestamp: 2,
    });
    await catalog.rebuild({ interruptAfter: 1 });
    expect((await catalog.search({ text: "cache invalidation", cursor: { workspaceId: "w1" } })).map((item) => item.evidenceId)).toEqual([
      "doc_a",
    ]);
    await catalog.rebuild();
    expect((await catalog.search({ text: "other", cursor: { workspaceId: "w1" } })).map((item) => item.evidenceId)).toEqual(["doc_b"]);
  });
});

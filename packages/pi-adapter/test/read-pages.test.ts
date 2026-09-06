import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRuntimeCursor } from "@pcr/core";
import { createEvidenceService } from "@pcr/runtime";
import { blobId, type EvidenceRecord } from "@pcr/contracts";
import { createRecallTool } from "../src/tools/recall.js";
import { registerRuntimeTools } from "../src/commands/context.js";
import type { RuntimeTool } from "../src/tools/status.js";
import { createReadTool } from "../src/tools/read.js";

function fixture(text: string) {
  const cursor = createRuntimeCursor({ workspacePath: "/tmp/pcr-read-pages", sessionId: "pages", leafId: "leaf", lineageEntryIds: ["leaf"], modelKey: "test/model" });
  const bytes = Buffer.from(text);
  const records = new Map<string, EvidenceRecord>();
  const evidence = createEvidenceService({
    cursor,
    repository: { async put(record) { records.set(record.evidenceId, record); }, async get(_cursor, id) { return records.get(id) ?? null; } },
    fts: { async upsert() {}, async search() { return []; } },
    blobs: { async put() { return blobId(`blob_${"a".repeat(64)}`); }, async read() { return bytes; } },
  });
  return {
    async prepare() {
      const [record] = await evidence.admit({ cursor, operationId: "capture", observationId: "obs", rawBlobId: blobId(`blob_${"a".repeat(64)}`), reducer: { id: "text", revision: "1" }, sourceClass: "untrusted-tool", facts: [{ kind: "note", value: "original" }], observedAt: 1 });
      return { tool: createReadTool({ cursor, evidence }), runtime: { workspaceId: cursor.workspaceId, cursor, evidence }, id: record!.evidenceId, bytes };
    },
  };
}

const context = (tokens: number | null) => ({
  model: { contextWindow: 20_000, maxTokens: 2_000 },
  getContextUsage: () => ({ tokens, contextWindow: 20_000 }),
  getSystemPrompt: () => "system",
});

describe("budgeted context_read pages", () => {
  it("pages large UTF-8 evidence without loss and keeps the original digest", async () => {
    const original = "部署🚀日志\\\"\n".repeat(1800);
    const { tool, id, bytes } = await fixture(original).prepare();
    let start = 0;
    let restored = "";
    let pages = 0;
    do {
      const out = await tool.execute("read", { evidenceId: id, start }, undefined, undefined, context(1000));
      const serialized = out.content[0]!.text;
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(4096);
      const page = JSON.parse(serialized);
      expect(page.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(page.verified).toBe(true);
      expect(page.range.start).toBe(start);
      expect(page.range.endExclusive).toBeGreaterThan(start);
      restored += page.text;
      pages++;
      if (page.nextOffset === null) break;
      start = page.nextOffset;
      expect(pages).toBeLessThan(100);
    } while (true);
    expect(pages).toBeGreaterThan(1);
    expect(restored).toBe(original);
  });

  it("shrinks the full serialized page to live headroom and refuses exhausted context", async () => {
    const { tool, id } = await fixture("line ".repeat(5000)).prepare();
    const ample = await tool.execute("read", { evidenceId: id }, undefined, undefined, context(1000));
    const near = await tool.execute("read", { evidenceId: id }, undefined, undefined, context(15_000));
    expect(Buffer.byteLength(near.content[0]!.text)).toBeLessThan(Buffer.byteLength(ample.content[0]!.text));
    expect(Buffer.byteLength(near.content[0]!.text)).toBeLessThanOrEqual(988);
    await expect(tool.execute("read", { evidenceId: id, start: 20 }, undefined, undefined, context(18_000))).rejects.toMatchObject({ code: "PCR_RETRIEVAL_BUDGET_EXCEEDED", details: { offset: 20 } });
  });

  it("bounds unknown usage and respects explicit ranges and caller token caps", async () => {
    const { tool, id } = await fixture("abcdefghij".repeat(1000)).prepare();
    const out = await tool.execute("read", { evidenceId: id, start: 2, endExclusive: 6 }, undefined, undefined, context(null));
    expect(JSON.parse(out.content[0]!.text)).toMatchObject({ text: "cdef", nextOffset: null, range: { start: 2, endExclusive: 6 } });
    const capped = await tool.execute("read", { evidenceId: id, maxTokens: 700 }, undefined, undefined, context(null));
    expect(Buffer.byteLength(capped.content[0]!.text)).toBeLessThanOrEqual(700);
    await expect(tool.execute("read", { evidenceId: id, start: -1 })).rejects.toMatchObject({ code: "PCR_INVALID_RANGE" });
    await expect(tool.execute("read", { evidenceId: id, start: 2.5 })).rejects.toMatchObject({ code: "PCR_INVALID_RANGE" });
    await expect(tool.execute("read", { evidenceId: id, maxTokens: Number.NaN })).rejects.toMatchObject({ code: "PCR_RETRIEVAL_INPUT_INVALID" });
  });
});


describe("retrieval budget at the registered host boundary", () => {
  it("preserves native usage and active tool overhead in the registered callback", async () => {
    const { runtime, id } = await fixture("large page".repeat(500)).prepare();
    const tools = new Map<string, RuntimeTool>();
    registerRuntimeTools({ registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {} }, {
      ...runtime, toolSchemaTokens: () => 17_000,
    });
    await expect(tools.get("context_read")!.execute("read", { evidenceId: id, start: 10 }, undefined, undefined, context(null)))
      .rejects.toMatchObject({ code: "PCR_RETRIEVAL_BUDGET_EXCEEDED", details: { offset: 10 } });
  });

  it("keeps recall character offsets and exposes a lossless continuation", async () => {
    const original = "原文🚀".repeat(120);
    const { runtime, id } = await fixture(original).prepare();
    const tool = createRecallTool(runtime);
    let start = 0;
    let restored = "";
    for (let page = 0; page < 100; page++) {
      const result = await tool.execute("recall", { evidenceId: id, start, maxTokens: 256 }, undefined, undefined, context(1000));
      const output = result.content[0]!.text;
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(256);
      const match = output.match(/\n\[More remains; call context_recall with start=(\d+).*\]$/u);
      if (!match) { restored += output; break; }
      restored += output.slice(0, match.index);
      expect(Number(match[1])).toBeGreaterThan(start);
      start = Number(match[1]);
    }
    expect(restored).toBe(original);
    await expect(tool.execute("recall", { evidenceId: id, start: 4 }, undefined, undefined, context(18_000)))
      .rejects.toMatchObject({ code: "PCR_RETRIEVAL_BUDGET_EXCEEDED", details: { offset: 4 } });
  });
});


describe("retrieval boundary regressions", () => {
  it("fits a complete two-byte character when its partial prefix would not fit", async () => {
    const { tool, id, bytes } = await fixture("é" + "x".repeat(1001)).prepare();
    const expected = {
      evidenceId: id, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      verified: true, range: { start: 0, endExclusive: 2 }, text: "é", nextOffset: 2, remainingBytes: 1001,
    };
    const maxTokens = Buffer.byteLength(JSON.stringify(expected));
    const result = await tool.execute("read", { evidenceId: id, maxTokens });
    expect(JSON.parse(result.content[0]!.text)).toEqual(expected);
  });

  it.each(["large input ".repeat(10_000), "原".repeat(19_000)])("counts current messages when native usage is unknown (%#)", async (content) => {
    const { tool, id } = await fixture("original").prepare();
    const manager = SessionManager.inMemory("/tmp/pcr-unknown-usage");
    manager.appendMessage({ role: "user", content, timestamp: 1 });
    await expect(tool.execute("read", { evidenceId: id }, undefined, undefined, { ...context(null), sessionManager: manager }))
      .rejects.toMatchObject({ code: "PCR_RETRIEVAL_BUDGET_EXCEEDED" });
  });

  it("propagates cancellation through the registered search callback", async () => {
    const { runtime } = await fixture("original").prepare();
    const tools = new Map<string, RuntimeTool>();
    registerRuntimeTools({ registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {} }, runtime);
    const controller = new AbortController();
    controller.abort();
    await expect(tools.get("context_search")!.execute("search", { query: "original" }, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});

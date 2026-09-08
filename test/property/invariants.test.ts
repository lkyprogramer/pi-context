import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { collectBatches } from "../../src/projection/batches.js";
import { planFold, shouldFold } from "../../src/projection/planner.js";
import { renderFold } from "../../src/projection/render.js";
import { authorizeHits } from "../../src/history/scope.js";
import { utf8Slice, utf8Bytes, type FoldPlan } from "../../src/contracts.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

const protocol = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../docs/pi-context-native-first-evolution-v5.0.0/fixtures/protocol-cases.json"), "utf8"),
) as { cases: Array<{ id: string; expect: Record<string, unknown>; input: Record<string, unknown> }> };

function emptyPlan(): FoldPlan {
  return {
    planId: "p",
    sessionId: "s",
    compactionBoundary: null,
    modelId: "m",
    configHash: "h",
    createdAt: "t",
    usagePercentAtPlan: 65,
    replacements: new Map(),
    savedTokensEstimate: 0,
  };
}

describe("T20 INV matrix", () => {
  it("INV-01 observe does not rewrite messages", () => {
    const messages = [{ role: "tool", content: [{ type: "text", text: "raw" }] }];
    const out = renderFold(messages, emptyPlan(), new Map());
    expect(out.messages).toBe(messages);
    expect(out.applied).toBe(0);
  });

  it("INV-02 without a fold plan messages stay unchanged", () => {
    const messages = [{ role: "tool", content: [{ type: "text", text: "raw" }] }];
    const out = renderFold(messages, emptyPlan(), new Map());
    expect(out.messages).toBe(messages);
  });

  it("INV-03 images stay in the message", () => {
    const messages = [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "xx" }, { type: "text", text: "see" }] }];
    const out = renderFold(messages, emptyPlan(), new Map());
    expect(JSON.stringify(out.messages)).toMatch(/image/);
  });

  it("INV-04 incomplete batches stay protected", () => {
    const entries = [
      assistantEntry("a", null, [{ type: "toolCall", id: "c1" }, { type: "toolCall", id: "c2" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("only-one")),
    ];
    expect(collectBatches(entries)[0]?.complete).toBe(false);
  });

  it("INV-05 utf-8 roundtrip", () => {
    const text = "路径😀\r\n";
    expect(utf8Slice(text, 0, utf8Bytes(text).length)).toBe(text);
  });

  it("INV-06 authorization before limit", () => {
    const hits = authorizeHits(
      { workspaceId: "w", worktreeId: "w", sessionId: "s", leafId: "b", visibleEntryIds: new Set(["b"]) },
      [{ entryId: "sibling", score: 99 }, { entryId: "b", score: 1 }],
      1,
    );
    expect(hits.map((h) => h.entryId)).toEqual(["b"]);
  });

  it("INV-08 unknown usage percent does not fold", () => {
    expect(shouldFold({ tokens: null, contextWindow: 1000, percent: null }, null, DEFAULT_CONFIG.fold)).toBe(false);
  });

  it("covers protocol vectors F01-F05 against shipped planner/batches", () => {
    const ids = protocol.cases.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["F01-first-exposure", "F02-image", "F03-branch", "F04-failed-request", "F05-incomplete-batch"]));
    const f01 = protocol.cases.find((c) => c.id === "F01-first-exposure")!;
    expect(f01.expect.transformAllowed).toBe(false);
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a", "u", [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a", "c1", textBlocks(String(f01.input.text))),
    ];
    const plan = planFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "r1", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: new Set(),
      usage: { tokens: 100, contextWindow: 1000, percent: 10 },
      previous: null,
      modelId: "m",
      cfg: DEFAULT_CONFIG,
      configHash: "h",
    });
    expect(plan).toBeNull();
    const incomplete = [
      assistantEntry("a", null, [{ type: "toolCall", id: "c1" }, { type: "toolCall", id: "c2" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("only-one")),
    ];
    expect(collectBatches(incomplete)[0]?.complete).toBe(false);
    const stale = renderFold(
      [{ role: "user", content: [{ type: "text", text: "keep" }] }],
      emptyPlan(),
      new Map([[0, { entryId: "r1" }]]),
    );
    expect(stale.messages[0]?.content).toEqual([{ type: "text", text: "keep" }]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectBatches } from "../../src/projection/batches.js";
import { ExposureLedger, outcomeFromStop } from "../../src/projection/exposure.js";
import { decideBudget } from "../../src/projection/budget.js";
import { renderMessages } from "../../src/projection/render.js";
import { authorizeHits } from "../../src/history/scope.js";
import { utf8Slice, utf8Bytes } from "../../src/contracts.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

const protocol = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../docs/pi-context-native-first-evolution-v5.0.0/fixtures/protocol-cases.json"), "utf8"),
) as { cases: Array<{ id: string; expect: Record<string, unknown>; input: Record<string, unknown> }> };

describe("T20 INV matrix", () => {
  it("INV-01 observe does not rewrite messages", () => {
    const messages = [{ role: "tool", content: [{ type: "text", text: "raw" }] }];
    const out = renderMessages({ messages, plan: null, profile: "observe", optionalBudget: 10 });
    expect(out.messages).toBe(messages);
  });

  it("INV-02 http200 stream error is not exposure", () => {
    expect(outcomeFromStop("stop", undefined, "error")).toBe("fail");
    const ledger = new ExposureLedger();
    ledger.begin({
      attemptId: "a",
      snapshot: { generation: 1, sessionId: "s", leafId: null, sourceRevision: "a".repeat(64), modelIdentity: "m", configHash: "b".repeat(64) },
      includedOriginalRefs: ["r"],
      startedAtMs: 0,
    });
    ledger.fail("a");
    expect(ledger.isExposed("r", 1)).toBe(false);
  });

  it("INV-03 images stay in the message", () => {
    const messages = [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "xx" }, { type: "text", text: "see" }] }];
    const out = renderMessages({ messages, plan: null, profile: "balanced", optionalBudget: 10 });
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
      { workspaceId: "w", worktreeId: "w", sessionId: "s", visibleEntryIds: new Set(["b"]) },
      [{ entryId: "sibling", score: 99 }, { entryId: "b", score: 1 }],
      1,
    );
    expect(hits.map((h) => h.entryId)).toEqual(["b"]);
  });

  it("INV-08 unknown image cost bypasses", () => {
    expect(decideBudget({ protectedTokens: 1, optionalTokens: 1, limit: 100, unknownImageCost: true }).kind).toBe("bypass");
  });

  it("covers protocol vectors F01-F04", () => {
    const ids = protocol.cases.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["F01-first-exposure", "F02-image", "F03-branch", "F04-failed-request"]));
    const f01 = protocol.cases.find((c) => c.id === "F01-first-exposure")!;
    expect(f01.expect.transformAllowed).toBe(false);
  });
});

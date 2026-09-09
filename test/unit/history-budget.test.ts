import { expect, it } from "vitest";
import { utf8Prefix, readHistory } from "../../src/history/read.js";
import { encodeRef, imageSourceHash, refForField } from "../../src/history/refs.js";
import { readBudgetFor } from "../../src/projection/budget.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

it("utf8Prefix never splits a code point", () => {
  expect(utf8Prefix("aΩ🙂b", 2)).toBe("a");
  expect(utf8Prefix("aΩ🙂b", 3)).toBe("aΩ");
  expect(utf8Prefix("aΩ🙂b", 6)).toBe("aΩ");
  expect(utf8Prefix("aΩ🙂b", 7)).toBe("aΩ🙂");
});

it("pages a long block verbatim within bytes and token budget", () => {
  const text = "Ω🙂".repeat(3000);
  const entry: NativeEntry = {
    id: "r",
    parentId: null,
    type: "message",
    message: { role: "toolResult", toolCallId: "c", toolName: "read", isError: false, content: [{ type: "text", text }] },
  };
  const scope: Scope = { workspaceId: "w", sessionId: "s", leafId: "r", visibleEntryIds: new Set(["r"]) };
  const ref = refForField(scope, entry, 0);
  if ("code" in ref) throw new Error(ref.code);
  const p1 = readHistory({
    scope,
    ref: encodeRef(ref),
    budget: { maxTokens: 1000, maxBytes: 7000, estimateKind: "character-estimate" },
    getEntry: () => entry,
  });
  expect(p1.ok && Buffer.byteLength(p1.page ?? "", "utf8") <= 7000).toBe(true);
  expect(utf8Prefix(text, Buffer.byteLength(p1.page ?? "", "utf8"))).toBe(p1.page);
  const p2 = readHistory({
    scope,
    ref: encodeRef(ref),
    cursor: p1.ok ? p1.nextCursor ?? undefined : undefined,
    budget: { maxTokens: 1000, maxBytes: 7000, estimateKind: "character-estimate" },
    getEntry: () => entry,
  });
  expect(p2.ok && (p1.ok ? p1.page : "") + (p2.page ?? "")).toBe(
    text.slice(0, (p1.ok ? p1.page?.length ?? 0 : 0) + (p2.ok ? p2.page?.length ?? 0 : 0)),
  );
});

it("rejects stale hashes, oversized images, overflow cursors, and tight remaining window", () => {
  const text = "hello";
  const entry: NativeEntry = {
    id: "r",
    parentId: null,
    type: "message",
    message: { role: "toolResult", toolCallId: "c", toolName: "read", isError: false, content: [{ type: "text", text }] },
  };
  const scope: Scope = { workspaceId: "w", sessionId: "s", leafId: "r", visibleEntryIds: new Set(["r"]) };
  const good = refForField(scope, entry, 0);
  if ("code" in good) throw new Error(good.code);
  const stale = readHistory({
    scope,
    ref: encodeRef({ ...good, sourceHash: "b".repeat(64) }),
    budget: { maxTokens: 100, maxBytes: 100, estimateKind: "character-estimate" },
    getEntry: () => entry,
  });
  expect(stale.code).toBe("stale-ref");
  expect(stale.diagnostic).toMatch(/STALE_REF/);
  const overflow = readHistory({
    scope,
    ref: encodeRef(good),
    cursor: Buffer.from(JSON.stringify({ ref: encodeRef(good), byteOffset: 99 }), "utf8").toString("base64url"),
    budget: { maxTokens: 100, maxBytes: 100, estimateKind: "character-estimate" },
    getEntry: () => entry,
  });
  expect(overflow.code).toBe("stale-cursor");
  const tight = readBudgetFor(DEFAULT_CONFIG, 4000, { tokens: 262000, contextWindow: 262144, percent: 99 });
  expect("insufficient" in tight).toBe(true);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const img: NativeEntry = {
    id: "r",
    parentId: null,
    type: "message",
    message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: png }] },
  };
  const imageRef = refForField(scope, img, 0);
  if ("code" in imageRef) throw new Error(imageRef.code);
  const hugeCfg = { ...DEFAULT_CONFIG, history: { ...DEFAULT_CONFIG.history, readMaxBytes: 4 } };
  const tooBig = readHistory({
    scope,
    ref: encodeRef(imageRef),
    budget: { maxTokens: 100, maxBytes: 4, estimateKind: "character-estimate" },
    config: hugeCfg,
    getEntry: () => img,
  });
  expect(tooBig.code).toBe("insufficient-context");
  const tampered = readHistory({
    scope,
    ref: encodeRef({ ...imageRef, sourceHash: imageSourceHash({ type: "image", mimeType: "image/png", data: "xxxx" }) }),
    budget: { maxTokens: 100, maxBytes: 10000, estimateKind: "character-estimate" },
    getEntry: () => img,
  });
  expect(tampered.code).toBe("stale-ref");
});

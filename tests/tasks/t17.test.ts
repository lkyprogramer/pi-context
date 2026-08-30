import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { blobId } from "@pcr/contracts";
import {
  createClauseSegmenter,
  createDirectiveExtractor,
  createRuntimeCursor,
  extractDirectiveCandidates,
} from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t17",
    sessionId: "session-t17",
    leafId: "leaf-t17",
    lineageEntryIds: ["root", "leaf-t17"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function turnFor(text: string, bound = cursor(), sourceClass: "authenticated-user" | "untrusted-user" = "authenticated-user") {
  const bytes = Buffer.from(text, "utf8");
  return {
    userTurnId: "user_turn_t17",
    cursor: bound,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"a".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t17",
    sourceClass,
    capturedAt: 17,
  };
}

async function runT17Fixture(): Promise<{ ok: true; task: "T17" }> {
  const bound = cursor();
  const text = "改为使用 SHA-256。Do not leak 密钥👍. Keep tests.";
  const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
  const extractor = createDirectiveExtractor({ cursor: bound });
  const first = extractor.extract(turnFor(text, bound), clauses);
  const second = extractDirectiveCandidates(turnFor(text, bound), clauses);
  expect(second).toEqual(first);
  const correction = first.find((item) => item.kind === "correction");
  const prohibition = first.find((item) => item.kind === "prohibition");
  expect(correction?.exactQuote).toContain("改为使用 SHA-256");
  expect(correction?.exactQuote.length).toBeGreaterThan("改为".length);
  expect(correction?.polarity).toBe("must");
  expect(prohibition?.exactQuote).toContain("Do not leak 密钥👍");
  expect(prohibition?.polarity).toBe("must-not");
  expect(first.every((item) => item.polarity !== "must-not" || item.kind === "prohibition")).toBe(true);
  expect(first.every((item) => item.authority === "act")).toBe(true);
  return { ok: true, task: "T17" };
}

describe("T17 Directive extraction with exact-clause fallback", () => {
  it("directive_extraction_with_exact_clause_fallback", async () => {
    await expect(runT17Fixture()).resolves.toEqual({ ok: true, task: "T17" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createDirectiveExtractor({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_DIRECTIVE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed turns before emitting candidates", () => {
    const bound = cursor();
    const extractor = createDirectiveExtractor({ cursor: bound });
    expect(() => extractor.extract({} as never, [])).toThrowError(/PCR_DIRECTIVE_INPUT_INVALID/);
  });

  it("replays the same candidates for the same turn and clauses", () => {
    const bound = cursor();
    const text = "不要修改 public API。";
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    const turn = turnFor(text, bound);
    expect(extractDirectiveCandidates(turn, clauses)).toEqual(extractDirectiveCandidates(turn, clauses));
  });

  it("rejects clauses from another workspace/session/branch", () => {
    const bound = cursor();
    const extractor = createDirectiveExtractor({ cursor: bound });
    const text = "不要修改 public API。";
    const other = { ...bound, sessionId: "other-session" };
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    expect(() => extractor.extract(turnFor(text, other), clauses)).toThrowError(/PCR_DIRECTIVE_SCOPE_MISMATCH/);
  });

  it("stops at the abort boundary before classifying clauses", () => {
    const bound = cursor();
    const extractor = createDirectiveExtractor({ cursor: bound });
    const text = "不要修改 public API。";
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    const controller = new AbortController();
    controller.abort();
    expect(() => extractor.extract(turnFor(text, bound), clauses, controller.signal)).toThrow();
  });
});

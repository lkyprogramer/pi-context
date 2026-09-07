import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createMessageCodec, type PiMessageEnvelope } from "@pcr/pi-adapter";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t24",
    sessionId: "session-t24",
    leafId: "leaf-t24",
    lineageEntryIds: ["root", "leaf-t24"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function codec() {
  return createMessageCodec({ cursor: cursor() });
}

function roundTrip(raw: unknown, entryId?: string): PiMessageEnvelope {
  const bound = cursor();
  return codec().wrap({ cursor: bound, raw, entryId });
}

async function runT24Fixture() {
  const user = roundTrip({ role: "user", content: "fix the parser", timestamp: 24 });
  const assistant = roundTrip({
    role: "assistant",
    timestamp: 25,
    content: [
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "ACK" },
    ],
    usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4 },
  });
  const tool = roundTrip({
    role: "toolResult",
    toolCallId: "call_t24",
    timestamp: 26,
    content: [{ type: "text", text: "ok" }],
  });
  const custom = roundTrip({
    role: "compaction",
    timestamp: 27,
    content: "compacted",
    summary: "keep envelope",
  }, "entry-compact");
  const envelopes = [user, assistant, tool, custom];
  for (const envelope of envelopes) {
    expect(envelope.hostMessageId).not.toMatch(/^pi_\d+$/u);
    expect(codec().unwrap(envelope)).toEqual(envelope.raw);
    expect(codec().wrap({ cursor: cursor(), raw: envelope.raw, entryId: envelope === custom ? "entry-compact" : undefined })).toEqual(envelope);
  }
  expect(user.normalized).toMatchObject({ role: "user", sourceClass: "authenticated-user" });
  expect(assistant.normalized.content).toEqual([{ type: "text", text: "ACK" }]);
  expect(assistant.opaqueBlocks).toEqual([{ type: "thinking", thinking: "plan" }]);
  expect((assistant.raw as { usage?: { totalTokens: number } }).usage?.totalTokens).toBe(4);
  expect(tool.normalized).toMatchObject({ role: "tool-result", toolCallId: "call_t24" });
  expect(custom.normalized.role).toBe("custom");
  expect("usage" in (codec().unwrap(roundTrip({
    role: "assistant",
    timestamp: 28,
    content: [{ type: "text", text: "no usage" }],
  })) as object)).toBe(false);
  return { ok: true as const, task: "T24" as const, envelopes };
}

describe("T24 Lossless Pi message envelope codec", () => {
  it("lossless_pi_message_envelope_codec", async () => {
    await expect(runT24Fixture()).resolves.toMatchObject({ ok: true, task: "T24" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createMessageCodec({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_MESSAGE_CODEC_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed raw messages", () => {
    expect(() => codec().wrap({ cursor: cursor(), raw: {} })).toThrowError(/PCR_MESSAGE_CODEC_INPUT_INVALID/);
    expect(() => codec().unwrap({} as never)).toThrowError(/PCR_MESSAGE_CODEC_INPUT_INVALID/);
  });

  it("replays the same raw message to an equal envelope", () => {
    const raw = { role: "user", content: "fix the parser", timestamp: 24 };
    expect(roundTrip(raw)).toEqual(roundTrip(raw));
  });

  it("rejects a cursor from another workspace/session/branch", () => {
    const other = { ...cursor(), sessionId: "other-session" };
    expect(() => codec().wrap({
      cursor: other,
      raw: { role: "user", content: "x", timestamp: 1 },
    })).toThrowError(/PCR_MESSAGE_CODEC_SCOPE_MISMATCH/);
  });

  it("does not invent zero usage for an assistant message", () => {
    const envelope = roundTrip({
      role: "assistant",
      timestamp: 1,
      content: [{ type: "text", text: "ACK" }],
    });
    expect((envelope.raw as { usage?: unknown }).usage).toBeUndefined();
    expect(codec().unwrap(envelope)).not.toHaveProperty("usage");
  });

  it("stops at the abort boundary before hashing", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => codec().wrap({
      cursor: cursor(),
      raw: { role: "user", content: "x", timestamp: 1 },
      signal: controller.signal,
    })).toThrow();
  });
});

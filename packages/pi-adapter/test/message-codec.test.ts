import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";

import { createMessageCodec } from "../src/message-codec.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-message-codec",
    sessionId: "session-codec",
    leafId: "leaf-codec",
    lineageEntryIds: ["root", "leaf-codec"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("message codec", () => {
  it("round-trips user, assistant, toolResult and custom roles without index ids", () => {
    const codec = createMessageCodec({ cursor: cursor() });
    const raw = { role: "toolResult", toolCallId: "call_1", timestamp: 2, content: [{ type: "text", text: "ok" }] };
    const envelope = codec.wrap({ cursor: cursor(), raw });
    expect(envelope.hostMessageId.startsWith("hm_")).toBe(true);
    expect(envelope.normalized.role).toBe("tool-result");
    expect(codec.unwrap(envelope)).toEqual(raw);
  });
});

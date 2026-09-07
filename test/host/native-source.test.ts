import { describe, expect, it } from "vitest";
import { mapOutbound, sameTextDifferentEntries } from "../../src/pi/source-reader.js";
import { imageTurn, textBlocks, userEntry } from "../../src/testing.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";

describe("T03 native source", () => {
  it("does not register an input intercept hook", () => {
    const events: string[] = [];
    const pi: PiExtensionAPI = {
      on(event, _h) { events.push(event); },
      registerTool() {},
      registerCommand() {},
    };
    bindHooks(pi);
    expect(events).not.toContain("input");
    expect(events).toContain("context");
    expect(events).toContain("tool_result");
  });

  it("keeps image blocks on the native user entry", () => {
    const fx = imageTurn();
    const img = (fx.entries[0]?.message?.content as { type: string }[]).find((b) => b.type === "image");
    expect(img).toBeTruthy();
  });

  it("does not merge same-text different entries; colliding toolCallIds with the same hash stay ambiguous", () => {
    const a = userEntry("a", null, textBlocks("same"));
    const b = userEntry("b", "a", textBlocks("same"));
    expect(sameTextDifferentEntries(a, b)).toBe(true);
    const mapped = mapOutbound(
      [{ role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "one" }] }],
      [
        { id: "r1", parentId: "a", type: "message", message: { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "one" }] } },
        { id: "r2", parentId: "a", type: "message", message: { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "one" }] } },
      ],
    );
    expect(mapped.size).toBe(0);
  });

  it("maps official SessionMessageEntry via message.toolCallId and ignores a decoy top-level field", () => {
    const official = {
      type: "message",
      id: "r0",
      parentId: "a0",
      timestamp: 1,
      message: {
        role: "toolResult",
        toolCallId: "c0",
        toolName: "bash",
        content: [{ type: "text", text: "hello" }],
        isError: false,
      },
    };
    expect(Object.prototype.hasOwnProperty.call(official, "toolCallId")).toBe(false);
    const outbound = [{ role: "toolResult", toolCallId: "c0", content: [{ type: "text", text: "hello" }] }];
    expect(mapOutbound(outbound, [official]).get(0)?.id).toBe("r0");
    const decoy = { ...official, toolCallId: "DECOY" };
    expect(mapOutbound(outbound, [decoy]).get(0)?.id).toBe("r0");
  });
});

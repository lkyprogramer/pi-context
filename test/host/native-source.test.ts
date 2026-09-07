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

  it("does not merge same-text different entries; colliding toolCallIds with different hashes are ambiguous", () => {
    const a = userEntry("a", null, textBlocks("same"));
    const b = userEntry("b", "a", textBlocks("same"));
    expect(sameTextDifferentEntries(a, b)).toBe(true);
    const mapped = mapOutbound(
      [{ role: "tool", content: [{ type: "toolResult", toolCallId: "x", text: "one" }] }],
      [
        { id: "r1", parentId: "a", type: "message", toolCallId: "x", message: { role: "tool", content: [{ type: "text", text: "one" }] } },
        { id: "r2", parentId: "a", type: "message", toolCallId: "x", message: { role: "tool", content: [{ type: "text", text: "two" }] } },
      ],
    );
    expect(mapped.size).toBe(0);
  });
});

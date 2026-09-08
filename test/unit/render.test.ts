import { describe, expect, it } from "vitest";
import { deepEqual, renderMessages } from "../../src/projection/render.js";

describe("T14 render", () => {
  it("observe/off returns the identical message array and does not mutate input", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const frozen = Object.freeze(messages);
    const out = renderMessages({ messages: frozen as never, plan: null, profile: "observe", optionalBudget: 1000 });
    expect(out.messages).toBe(frozen);
    expect(deepEqual(out.messages, messages)).toBe(true);
  });

  it("preserves image blocks even when a plan exists", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", mimeType: "image/png", data: "xx" }] }];
    const out = renderMessages({
      messages,
      plan: {
        epochId: "e",
        replacements: [],
        firstChangedMessageIndex: null,
        planHash: "p",
      },
      profile: "balanced",
      optionalBudget: 100,
    });
    expect(out.messages[0]?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
  });
});

import { describe, expect, it } from "vitest";
import { deepEqual, renderFold } from "../../src/projection/render.js";
import type { FoldPlan } from "../../src/contracts.js";

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

describe("T14 render", () => {
  it("observe/off returns the identical message array and does not mutate input", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const frozen = Object.freeze(messages);
    const out = renderFold(frozen as never, emptyPlan(), new Map());
    expect(out.messages).toBe(frozen);
    expect(out.applied).toBe(0);
    expect(deepEqual(out.messages, messages)).toBe(true);
  });

  it("preserves image blocks even when a plan exists", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", mimeType: "image/png", data: "xx" }] }];
    const out = renderFold(messages, emptyPlan(), new Map([[0, { entryId: "u" }]]));
    expect(out.messages[0]?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
  });
});

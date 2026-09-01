import { describe, expect, it } from "vitest";

import { scoreToolPairsFromSession } from "../../packages/benchmark/src/continuation/runner.js";

describe("session tool-pair scorer", () => {
  it("counts orphan results and mismatched names as violations", () => {
    const paired = scoreToolPairsFromSession([
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "read" }],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "c1", toolName: "read" },
      },
    ]);
    expect(paired).toEqual({ toolPairViolations: 0, calls: 1, results: 1 });

    const orphan = scoreToolPairsFromSession([
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "c-orphan", toolName: "bash" },
      },
    ]);
    expect(orphan.toolPairViolations).toBe(1);
    expect(orphan.results).toBe(1);
    expect(orphan.calls).toBe(0);

    const mismatch = scoreToolPairsFromSession([
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c2", name: "read" }],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "c2", toolName: "bash" },
      },
    ]);
    expect(mismatch.toolPairViolations).toBe(1);
  });
});

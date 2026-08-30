import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import { createProactiveRecallPolicy } from "../../src/retrieval/proactive.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-core-recall",
    sessionId: "session-recall",
    leafId: "leaf-recall",
    lineageEntryIds: ["root", "leaf-recall"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("proactive recall policy", () => {
  it("returns not-needed when the catalog is empty", async () => {
    const bound = cursor();
    const policy = createProactiveRecallPolicy({
      cursor: bound,
      catalog: { async search() { return []; } },
      leases: { async grant() { throw new Error("lease should not be granted"); } },
    });
    const decision = await policy.decide({
      cursor: bound,
      userText: "hello",
      maxTokens: 50,
    });
    expect(decision.kind).toBe("not-needed");
  });
});

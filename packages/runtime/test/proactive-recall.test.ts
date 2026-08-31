import { describe, expect, it } from "vitest";

import { createProactiveRecallPolicy, createRuntimeCursor } from "@pcr/core";

const cursor = createRuntimeCursor({
  workspacePath: "/tmp/pcr-recall",
  sessionId: "session-recall",
  leafId: "leaf-recall",
  lineageEntryIds: ["root", "leaf-recall"],
  modelKey: "openclaw/Qwen3.8-27B-WORK",
});

describe("proactive recall", () => {
  it("injects when needed, stays silent otherwise, and drops stale conflicts", async () => {
    const policy = createProactiveRecallPolicy({
      cursor,
      catalog: {
        async search(query) {
          if (query.text.includes("cache invalidation")) {
            return [{ evidenceId: "ev-needed", quote: "invalidate cache on write", tokens: 8 }];
          }
          return [];
        },
      },
      leases: {
        async grant(input) {
          return {
            leaseId: "lease-1",
            pageId: "page-1",
            purpose: input.purpose,
            authority: "inform",
            turns: 1,
            tokenTurns: 8,
            expiresAt: Date.now() + 1000,
          };
        },
      },
    });
    const needed = await policy.decide({
      cursor,
      userText: "what is the cache invalidation strategy?",
      maxTokens: 64,
    });
    expect(needed.kind).toBe("needed");
    const silent = await policy.decide({
      cursor,
      userText: "hello",
      maxTokens: 64,
    });
    expect(silent.kind).toBe("not-needed");
    const completed = await policy.decide({
      cursor,
      userText: "cache invalidation",
      maxTokens: 64,
      taskStatus: "completed",
    });
    expect(completed.kind).toBe("not-needed");
  });
});

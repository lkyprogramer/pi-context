import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import { createRuntimeCursor } from "../../src/identity/index.js";
import { createTokenPricer } from "../../src/budget/pricer.js";
import { createCacheReceipt, type CacheReceiptRecord, type CacheReceiptStore } from "../../src/materialization/cache.js";
import { createSectionPlanner } from "../../src/materialization/sections.js";
import { createMaterializer } from "../../src/materialization/materializer.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-materializer",
    sessionId: "session-materializer",
    leafId: "leaf-materializer",
    lineageEntryIds: ["root", "leaf-materializer"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function user(text: string, id = "u1"): HostMessage {
  return {
    hostMessageId: id,
    role: "user",
    timestamp: 1,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

describe("budget-correct materializer", () => {
  it("reads directives from the snapshot instead of a keep constant", async () => {
    const bound = cursor();
    const pricer = createTokenPricer({
      cursor: bound,
      routes: {
        "openclaw/Qwen3.8-27B-WORK": {
          modelKey: "openclaw/Qwen3.8-27B-WORK",
          contextWindow: 8000,
          maxOutputTokens: 1000,
          providerReservedTokens: 0,
        },
      },
    });
    const rows: CacheReceiptRecord[] = [];
    const store: CacheReceiptStore = {
      async put(receipt) { rows.push(receipt); },
      async head() { return rows.at(-1) ?? null; },
    };
    const materializer = createMaterializer({
      cursor: bound,
      pricer,
      planner: createSectionPlanner({ cursor: bound, pricer }),
      cache: createCacheReceipt({ cursor: bound, store }),
    });
    const view = await materializer.materialize(
      {
        cursor: bound,
        canonicalMessages: [user("hello")],
        currentContextWindow: 8000,
        maxOutputTokens: 1000,
        reason: "normal",
        now: 1,
      },
      { cursor: bound, directives: [user("never keep", "d1")], continuity: [] },
    );
    expect(view.messages.map((item) => item.content[0])).toContainEqual({ type: "text", text: "never keep" });
    expect(view.messages.map((item) => item.content[0])).not.toContainEqual({ type: "text", text: "keep" });
  });
});

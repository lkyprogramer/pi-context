import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import { createCacheReceipt, type CacheReceiptRecord, type CacheReceiptStore } from "../../src/materialization/cache.js";
import type { SectionPlan } from "../../src/materialization/sections.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-cache-receipt",
    sessionId: "session-cache",
    leafId: "leaf-cache",
    lineageEntryIds: ["root", "leaf-cache"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function store(): CacheReceiptStore {
  const rows: CacheReceiptRecord[] = [];
  return {
    async put(receipt) {
      rows.push(receipt);
    },
    async head(scope) {
      return [...rows].reverse().find((row) => row.cursor.sessionId === scope.sessionId) ?? null;
    },
  };
}

function plan(kind: SectionPlan["kind"], hash: string, tokenCost: number): SectionPlan {
  return {
    kind,
    zone: kind === "historical-tail" ? "append-only-history" : kind === "active-turn" ? "active-turn" : "stable-prefix",
    contentHash: hash,
    tokenCost,
    messages: [],
  };
}

describe("cache receipt", () => {
  it("computes first-different from section hashes not kind order alone", async () => {
    const bound = cursor();
    const cache = createCacheReceipt({ cursor: bound, store: store() });
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const prefix = [
      plan("runtime-preamble", a, 10),
      plan("hard-directives", a, 20),
      plan("historical-tail", a, 30),
    ];
    await cache.commit({ cursor: bound, sections: prefix });
    const drifted = [
      plan("runtime-preamble", a, 10),
      plan("hard-directives", b, 20),
      plan("historical-tail", a, 30),
    ];
    const receipt = await cache.commit({ cursor: bound, sections: drifted });
    expect(receipt.firstDifferentSection).toBe("hard-directives");
    expect(receipt.eligiblePrefixTokens).toBe(10);
  });
});

import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import {
  CACHE_LAYOUT_VERSION,
  createCacheReceipt,
  createMaterializer,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
  type CacheReceiptStore,
} from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-cache-layout",
    sessionId: "session-cache-layout",
    leafId: "leaf-cache-layout",
    lineageEntryIds: ["root", "leaf-cache-layout"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function user(text: string, id: string): HostMessage {
  return {
    hostMessageId: id,
    role: "user",
    timestamp: 1,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

function store(): { rows: CacheReceiptRecord[]; store: CacheReceiptStore } {
  const rows: CacheReceiptRecord[] = [];
  return {
    rows,
    store: {
      async put(receipt) { rows.push(receipt); },
      async head() { return rows.at(-1) ?? null; },
    },
  };
}

function harness(bound = cursor()) {
  const pricer = createTokenPricer({
    cursor: bound,
    routes: {
      [bound.modelKey]: {
        modelKey: bound.modelKey,
        contextWindow: 16_000,
        maxOutputTokens: 1000,
        providerReservedTokens: 0,
      },
    },
  });
  const cacheRows = store();
  return {
    bound,
    cacheRows,
    materializer: createMaterializer({
      cursor: bound,
      pricer,
      planner: createSectionPlanner({ cursor: bound, pricer }),
      cache: createCacheReceipt({ cursor: bound, store: cacheRows.store }),
    }),
  };
}

describe("stable prefix cache layout", () => {
  it("keeps a no-op follow-up on the same prefix", async () => {
    const { bound, materializer } = harness();
    const request = {
      cursor: bound,
      canonicalMessages: [user("hello", "u1")],
      currentContextWindow: 16_000,
      maxOutputTokens: 1000,
      reason: "normal" as const,
      now: 1,
    };
    const snapshot = { cursor: bound, directives: [user("keep going", "d1")], continuity: [] };
    const first = await materializer.materialize(request, snapshot);
    const second = await materializer.materialize(request, snapshot);
    const third = await materializer.materialize(request, snapshot);
    expect(first.cachePlan.layoutVersion).toBe(CACHE_LAYOUT_VERSION);
    expect(second.cachePlan.firstDifferentSection).toBeNull();
    expect(third.cachePlan.firstDifferentSection).toBeNull();
    expect(second.cachePlan.eligiblePrefixTokens).toBeGreaterThan(0);
    expect(third.cachePlan.eligiblePrefixTokens).toBe(second.cachePlan.eligiblePrefixTokens);
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("marks the first different section when one directive updates", async () => {
    const { bound, materializer } = harness();
    const request = {
      cursor: bound,
      canonicalMessages: [user("hello", "u1")],
      currentContextWindow: 16_000,
      maxOutputTokens: 1000,
      reason: "normal" as const,
      now: 1,
    };
    await materializer.materialize(request, { cursor: bound, directives: [user("keep going", "d1")], continuity: [] });
    const next = await materializer.materialize(request, { cursor: bound, directives: [user("stop now", "d2")], continuity: [] });
    expect(next.cachePlan.firstDifferentSection).toBe("hard-directives");
    expect(next.cachePlan.eligiblePrefixTokens).toBeGreaterThan(0);
  });

  it("places recall in the volatile tail without changing output identity across cache stores", async () => {
    const bound = cursor();
    const first = harness(bound);
    const second = harness(bound);
    const request = {
      cursor: bound,
      canonicalMessages: [user("hello", "u1")],
      currentContextWindow: 16_000,
      maxOutputTokens: 1000,
      reason: "normal" as const,
      now: 1,
    };
    const recall: HostMessage = {
      hostMessageId: "recall-1",
      role: "custom",
      timestamp: 2,
      sourceClass: "system",
      content: [{ type: "text", text: "evidence: deploy window is Friday" }],
    };
    const withRecall = await first.materializer.materialize(request, {
      cursor: bound,
      directives: [user("keep going", "d1")],
      continuity: [],
      continuityDelta: [user("delta goal", "c-delta")],
      recall: [recall],
      directory: [{
        hostMessageId: "dir-1",
        role: "custom",
        timestamp: 2,
        sourceClass: "system",
        content: [{ type: "text", text: "directory" }],
      }],
    });
    const again = await second.materializer.materialize(request, {
      cursor: bound,
      directives: [user("keep going", "d1")],
      continuity: [],
      continuityDelta: [user("delta goal", "c-delta")],
      recall: [recall],
      directory: [{
        hostMessageId: "dir-1",
        role: "custom",
        timestamp: 2,
        sourceClass: "system",
        content: [{ type: "text", text: "directory" }],
      }],
    });
    expect(withRecall.sections.map((item) => item.kind)).toEqual([
      "runtime-preamble",
      "hard-directives",
      "stable-continuity",
      "continuity-delta",
      "directory",
      "retrieval-page",
      "active-turn",
    ]);
    expect(withRecall.sections.find((item) => item.kind === "retrieval-page")?.cacheZone).toBe("volatile-augmentation");
    expect(withRecall.sections.find((item) => item.kind === "directory")?.cacheZone).toBe("volatile-augmentation");
    expect(withRecall.outputHash).toBe(again.outputHash);
  });
});

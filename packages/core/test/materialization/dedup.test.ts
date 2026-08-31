import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import { createRuntimeCursor } from "../../src/identity/index.js";
import { createTokenPricer } from "../../src/budget/pricer.js";
import { createCacheReceipt, type CacheReceiptRecord, type CacheReceiptStore } from "../../src/materialization/cache.js";
import { createSectionPlanner } from "../../src/materialization/sections.js";
import { createMaterializer } from "../../src/materialization/materializer.js";
import { dedupMaterializationMessages } from "../../src/materialization/dedup.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-dedup",
    sessionId: "session-dedup",
    leafId: "leaf-dedup",
    lineageEntryIds: ["root", "leaf-dedup"],
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

function custom(text: string, id: string): HostMessage {
  return {
    hostMessageId: id,
    role: "custom",
    timestamp: 1,
    sourceClass: "agent-derived",
    content: [{ type: "text", text }],
  };
}

describe("directive / history / active-turn dedup", () => {
  it("keeps the same user once when it appears in history and directives", () => {
    const original = user("set version to 7", "u-history");
    const copy = user("set version to 7", "u-directive");
    const latest = user("continue", "u-latest");
    const owned = dedupMaterializationMessages([copy], [original], [latest]);
    expect(owned.history.map((item) => item.hostMessageId)).toEqual(["u-history"]);
    expect(owned.directives).toEqual([]);
    expect(owned.active.map((item) => item.hostMessageId)).toEqual(["u-latest"]);
  });

  it("does not duplicate a compaction summary envelope", () => {
    const summary = custom("checkpoint: do not deploy", "sum-history");
    const again = custom("checkpoint: do not deploy", "sum-directive");
    const owned = dedupMaterializationMessages([again], [summary], [user("next", "u1")]);
    const texts = [...owned.directives, ...owned.history, ...owned.active].map((item) => (
      item.content[0] && item.content[0].type === "text" ? item.content[0].text : ""
    ));
    expect(texts.filter((text) => text === "checkpoint: do not deploy")).toHaveLength(1);
  });

  it("keeps a tool pair together", () => {
    const call: HostMessage = {
      hostMessageId: "a1",
      role: "assistant",
      timestamp: 1,
      sourceClass: "agent-derived",
      toolCallId: "call_1",
      content: [{ type: "text", text: "calling bash" }],
    };
    const result: HostMessage = {
      hostMessageId: "t1",
      role: "tool-result",
      timestamp: 2,
      sourceClass: "untrusted-tool",
      toolCallId: "call_1",
      content: [{ type: "text", text: "ok" }],
    };
    const owned = dedupMaterializationMessages([], [call, result], [user("next", "u1")]);
    expect(owned.history.map((item) => item.hostMessageId)).toEqual(["a1", "t1"]);
  });

  it("materializes the latest user last without duplicate content hashes", async () => {
    const bound = cursor();
    const pricer = createTokenPricer({
      cursor: bound,
      routes: {
        [bound.modelKey]: {
          modelKey: bound.modelKey,
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
        canonicalMessages: [user("set version to 7", "u-old"), user("continue with the plan", "u-new")],
        currentContextWindow: 8000,
        maxOutputTokens: 1000,
        reason: "normal",
        now: 1,
      },
      { cursor: bound, directives: [user("set version to 7", "d1")], continuity: [] },
    );
    const hashes = view.messages.map((item) => JSON.stringify({ role: item.role, content: item.content }));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(view.messages.at(-1)?.hostMessageId).toBe("u-new");
    expect(view.messages.filter((item) => item.content[0] && item.content[0].type === "text" && item.content[0].text === "set version to 7")).toHaveLength(1);
  });
});

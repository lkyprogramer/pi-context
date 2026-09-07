import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import {
  createCacheReceipt,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
  type CacheReceiptStore,
  type SectionPlan,
} from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t26",
    sessionId: "session-t26",
    leafId: "leaf-t26",
    lineageEntryIds: ["root", "leaf-t26"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

const ROUTE = {
  modelKey: "openclaw/Qwen3.8-27B-WORK",
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;

function message(id: string, text: string): HostMessage {
  return {
    hostMessageId: id,
    role: "user",
    timestamp: 26,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

function memoryStore(): CacheReceiptStore {
  const rows: CacheReceiptRecord[] = [];
  return {
    async put(receipt) {
      const index = rows.findIndex((row) => (
        row.viewId === receipt.viewId
        && row.cursor.workspaceId === receipt.cursor.workspaceId
        && row.cursor.sessionId === receipt.cursor.sessionId
      ));
      if (index >= 0) rows[index] = receipt;
      else rows.push(receipt);
    },
    async head(scope) {
      return [...rows].reverse().find((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
  };
}

function stack() {
  const bound = cursor();
  const pricer = createTokenPricer({ cursor: bound, routes: { [ROUTE.modelKey]: ROUTE } });
  const planner = createSectionPlanner({ cursor: bound, pricer });
  const store = memoryStore();
  const cache = createCacheReceipt({ cursor: bound, store });
  return { bound, planner, cache };
}

function sectionInput() {
  return [
    { kind: "runtime-preamble" as const, messages: [message("preamble", "pcr-runtime")] },
    { kind: "hard-directives" as const, messages: [message("dir", "keep version 7")] },
    { kind: "stable-continuity" as const, messages: [message("cont", "active: write docs")] },
    { kind: "historical-tail" as const, messages: [message("hist", "old turn")] },
    { kind: "active-turn" as const, messages: [message("turn", "fix the parser")] },
  ];
}

async function runT26Fixture() {
  const { bound, planner, cache } = stack();
  const firstPlans = await planner.plan({ cursor: bound, sections: sectionInput() });
  expect(firstPlans.map((item) => item.kind)).toEqual([
    "runtime-preamble",
    "hard-directives",
    "stable-continuity",
    "historical-tail",
    "active-turn",
  ]);
  expect(firstPlans.every((item) => /^[a-f0-9]{64}$/u.test(item.contentHash))).toBe(true);
  expect(firstPlans[4]?.zone).toBe("active-turn");
  expect(firstPlans[0]?.tokenCost).toBeGreaterThan(0);
  const first = await cache.commit({ cursor: bound, sections: firstPlans });
  expect(first.previousViewId).toBeNull();
  expect(first.firstDifferentSection).toBe("runtime-preamble");
  const replayedPlans = await planner.plan({ cursor: bound, sections: sectionInput() });
  expect(replayedPlans).toEqual(firstPlans);
  const unchanged = await cache.commit({ cursor: bound, sections: replayedPlans });
  expect(unchanged.viewId).toBe(first.viewId);
  expect(unchanged.firstDifferentSection).toBeNull();
  expect(unchanged.previousViewId).toBe(first.viewId);
  const drifted = sectionInput();
  drifted[3] = { kind: "historical-tail", messages: [message("hist", "old turn plus more history")] };
  const nextPlans = await planner.plan({ cursor: bound, sections: drifted });
  expect(nextPlans[3]?.contentHash).not.toBe(firstPlans[3]?.contentHash);
  expect(nextPlans[0]?.contentHash).toBe(firstPlans[0]?.contentHash);
  const delta = await cache.commit({ cursor: bound, sections: nextPlans });
  expect(delta.viewId).not.toBe(first.viewId);
  expect(delta.firstDifferentSection).toBe("historical-tail");
  expect(delta.previousViewId).toBe(first.viewId);
  expect(delta.eligiblePrefixTokens).toBe(
    firstPlans.slice(0, 3).reduce((sum: number, item: SectionPlan) => sum + item.tokenCost, 0),
  );
  expect(await cache.current(bound)).toEqual(delta);
  return { ok: true as const, task: "T26" as const, first, delta };
}

describe("T26 Section model and cache receipt", () => {
  it("section_model_and_cache_receipt", async () => {
    await expect(runT26Fixture()).resolves.toMatchObject({ ok: true, task: "T26" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createSectionPlanner({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_SECTION_DEPENDENCY_MISSING" }),
    );
    expect(() => createCacheReceipt({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CACHE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed section input", async () => {
    const { bound, planner } = stack();
    await expect(planner.plan({} as never)).rejects.toThrow(/PCR_SECTION_INPUT_INVALID/);
    await expect(planner.plan({
      cursor: bound,
      sections: [{ kind: "not-a-section" as never, messages: [message("x", "x")] }],
    })).rejects.toThrow(/PCR_SECTION_INPUT_INVALID/);
  });

  it("replays the same sections to an equal plan and receipt", async () => {
    const { bound, planner, cache } = stack();
    const plans = await planner.plan({ cursor: bound, sections: sectionInput() });
    const first = await cache.commit({ cursor: bound, sections: plans });
    const second = await cache.commit({ cursor: bound, sections: plans });
    expect(second.viewId).toBe(first.viewId);
    expect(second.firstDifferentSection).toBeNull();
    expect(second.previousViewId).toBe(first.viewId);
    expect(second.sections).toEqual(first.sections);
  });

  it("rejects a cursor from another workspace/session/branch", async () => {
    const { planner, cache } = stack();
    const other = { ...cursor(), sessionId: "other-session" };
    await expect(planner.plan({ cursor: other, sections: sectionInput() })).rejects.toThrow(/PCR_SECTION_SCOPE_MISMATCH/);
    await expect(cache.current(other)).rejects.toThrow(/PCR_CACHE_SCOPE_MISMATCH/);
  });

  it("does not treat same-kind sections as reusable when the body hash changes", async () => {
    const { bound, planner, cache } = stack();
    const original = await planner.plan({ cursor: bound, sections: sectionInput() });
    await cache.commit({ cursor: bound, sections: original });
    const mutated = sectionInput();
    mutated[1] = { kind: "hard-directives", messages: [message("dir", "keep version 8")] };
    const next = await planner.plan({ cursor: bound, sections: mutated });
    const receipt = await cache.commit({ cursor: bound, sections: next });
    expect(receipt.firstDifferentSection).toBe("hard-directives");
    expect(receipt.eligiblePrefixTokens).toBe(original[0]!.tokenCost);
  });

  it("stops at the abort boundary before hashing", async () => {
    const { bound, planner } = stack();
    const controller = new AbortController();
    controller.abort();
    await expect(planner.plan({
      cursor: bound,
      sections: sectionInput(),
      signal: controller.signal,
    })).rejects.toThrow();
  });
});

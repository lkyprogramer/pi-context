import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import {
  createCacheReceipt,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
  type CacheReceiptStore,
} from "@pcr/core";
import { createEconomicsController, type RealizedNet } from "@pcr/runtime";

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));
const MODEL = "openclaw/Qwen3.8-27B-WORK";
const ROUTE = {
  modelKey: MODEL,
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;
const PRICES = { inputPerToken: 2, outputPerToken: 3 } as const;

function cursor() {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t38",
    leafId: "leaf-t38",
    lineageEntryIds: ["root", "leaf-t38"],
    modelKey: MODEL,
  });
}

function message(id: string, text: string): HostMessage {
  return {
    hostMessageId: id,
    role: "user",
    timestamp: 38,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

function memoryStore(): CacheReceiptStore {
  const rows: CacheReceiptRecord[] = [];
  return {
    async put(receipt) {
      rows.push(receipt);
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

async function stack() {
  const bound = cursor();
  const pricer = createTokenPricer({ cursor: bound, routes: { [MODEL]: ROUTE } });
  const planner = createSectionPlanner({ cursor: bound, pricer });
  const cache = createCacheReceipt({ cursor: bound, store: memoryStore() });
  const first = await planner.plan({
    cursor: bound,
    sections: [
      { kind: "runtime-preamble", messages: [message("preamble", "pcr-runtime")] },
      { kind: "hard-directives", messages: [message("dir", "keep version 7")] },
      { kind: "stable-continuity", messages: [message("cont", "write docs")] },
      { kind: "historical-tail", messages: [message("hist", "old turn")] },
      { kind: "active-turn", messages: [message("turn", "fix parser")] },
    ],
  });
  await cache.commit({ cursor: bound, sections: first });
  const second = await planner.plan({
    cursor: bound,
    sections: [
      { kind: "runtime-preamble", messages: [message("preamble", "pcr-runtime")] },
      { kind: "hard-directives", messages: [message("dir", "keep version 7")] },
      { kind: "stable-continuity", messages: [message("cont", "write docs")] },
      { kind: "historical-tail", messages: [message("hist", "old turn plus more history")] },
      { kind: "active-turn", messages: [message("turn", "fix parser now")] },
    ],
  });
  await cache.commit({ cursor: bound, sections: second });
  const controller = createEconomicsController({
    cursor: bound,
    cache,
    prices: PRICES,
    routes: { [MODEL]: ROUTE },
  });
  return { bound, cache, controller };
}

async function runT38Fixture() {
  const { bound, cache, controller } = await stack();
  const receipt = await cache.current(bound);
  expect(receipt?.previousViewId).not.toBeNull();
  expect(receipt?.eligiblePrefixTokens).toBeGreaterThan(0);
  const input = {
    cursor: bound,
    tokensBefore: 190_000,
    tokensAfter: 12_000,
    summaryTokens: 400,
    recallTokens: 50,
    succeeded: true,
  };
  const first = await controller.realize(input);
  const report: RealizedNet = first;
  expect(report.avoidedInput).toBe((190_000 - 12_000) * PRICES.inputPerToken);
  expect(report.avoidedOverflow).toBeGreaterThan(0);
  expect(report.summaryCost).toBe(400 * PRICES.outputPerToken);
  expect(report.recallCost).toBe(50 * PRICES.inputPerToken);
  expect(report.cacheRewrite).toBe((receipt!.sections.reduce((sum, item) => sum + item.tokenCost, 0) - receipt!.eligiblePrefixTokens) * PRICES.inputPerToken);
  expect(report.failureCost).toBe(0);
  expect(report.net).toBe(
    report.avoidedInput + report.avoidedOverflow - report.summaryCost - report.recallCost - report.cacheRewrite - report.failureCost,
  );
  const replayed = await controller.realize(input);
  expect(replayed).toEqual(first);
  const failed = await controller.realize({ ...input, succeeded: false });
  expect(failed.avoidedInput).toBe(0);
  expect(failed.avoidedOverflow).toBe(0);
  expect(failed.failureCost).toBeGreaterThan(0);
  expect(failed.net).toBeLessThan(first.net);
  return { ok: true as const, task: "T38" as const, report };
}

describe("T38 Cache-adjusted economics controller", () => {
  it("cache_adjusted_economics_controller", async () => {
    await expect(runT38Fixture()).resolves.toMatchObject({ ok: true, task: "T38" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createEconomicsController({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_ECONOMICS_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed realize input", async () => {
    const { bound, controller } = await stack();
    await expect(controller.realize({} as never)).rejects.toMatchObject({
      code: "PCR_ECONOMICS_INPUT_INVALID",
    });
    await expect(controller.realize({
      cursor: bound,
      tokensBefore: -1,
      tokensAfter: 1,
      summaryTokens: 0,
      recallTokens: 0,
      succeeded: true,
    })).rejects.toMatchObject({ code: "PCR_ECONOMICS_INPUT_INVALID" });
  });

  it("replays equal realized net for the same sample", async () => {
    const { bound, controller } = await stack();
    const input = {
      cursor: bound,
      tokensBefore: 40_000,
      tokensAfter: 10_000,
      summaryTokens: 100,
      recallTokens: 10,
      succeeded: true,
    };
    expect(await controller.realize(input)).toEqual(await controller.realize(input));
  });

  it("rejects a cursor from another workspace", async () => {
    const { controller } = await stack();
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t38",
      leafId: "leaf-t38",
      lineageEntryIds: ["root", "leaf-t38"],
      modelKey: MODEL,
    });
    await expect(controller.realize({
      cursor: other,
      tokensBefore: 1000,
      tokensAfter: 100,
      summaryTokens: 1,
      recallTokens: 0,
      succeeded: true,
    })).rejects.toMatchObject({ code: "PCR_ECONOMICS_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before reading cache", async () => {
    const bound = cursor();
    let read = 0;
    const controller = createEconomicsController({
      cursor: bound,
      cache: {
        async current() {
          read += 1;
          throw new Error("should not read cache");
        },
      },
      prices: PRICES,
      routes: { [MODEL]: ROUTE },
    });
    await expect(controller.realize({
      cursor: bound,
      tokensBefore: 1000,
      tokensAfter: 100,
      summaryTokens: 1,
      recallTokens: 0,
      succeeded: true,
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(read).toBe(0);
  });
});

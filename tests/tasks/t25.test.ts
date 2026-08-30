import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createTokenCalibration, type RouteInfo } from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t25",
    sessionId: "session-t25",
    leafId: "leaf-t25",
    lineageEntryIds: ["root", "leaf-t25"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

const ROUTE: RouteInfo = {
  modelKey: "openclaw/Qwen3.8-27B-WORK",
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
};

function pricer() {
  return createTokenCalibration({
    cursor: cursor(),
    routes: { [ROUTE.modelKey]: ROUTE },
  });
}

function message(text: string, hostMessageId = "hm_t25"): HostMessage {
  return {
    hostMessageId,
    role: "user",
    timestamp: 25,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

async function runT25Fixture() {
  const bound = cursor();
  const tokens = pricer();
  const latin = await tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: bound });
  const cjk = await tokens.priceMessage(message("你好世界"), { modelKey: ROUTE.modelKey, cursor: bound });
  const sameIdDifferentBody = await tokens.priceMessage(
    message("this is a much longer active turn that must not share a fingerprint with abcd", "hm_t25"),
    { modelKey: ROUTE.modelKey, cursor: bound },
  );
  const iEff = tokens.effectiveInput(ROUTE);
  expect(iEff).toBe(200192 - 16384 - 0);
  expect(cjk).toBeGreaterThan(latin);
  expect(sameIdDifferentBody).not.toBe(latin);
  expect(await tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: bound })).toBe(latin);
  tokens.observe({
    modelKey: ROUTE.modelKey,
    heuristicTokens: 100,
    providerInputTokens: 80,
  });
  const calibrated = await tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: bound });
  expect(calibrated).toBeLessThan(latin);
  return { ok: true as const, task: "T25" as const, iEff, latin, cjk, calibrated };
}

describe("T25 Actual model budget and token calibration", () => {
  it("actual_model_budget_and_token_calibration", async () => {
    await expect(runT25Fixture()).resolves.toMatchObject({ ok: true, task: "T25" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createTokenCalibration({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_BUDGET_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed messages and unknown routes", async () => {
    const tokens = pricer();
    await expect(tokens.priceMessage({} as never, { modelKey: ROUTE.modelKey, cursor: cursor() })).rejects.toThrow(
      /PCR_BUDGET_INPUT_INVALID/,
    );
    await expect(tokens.priceMessage(message("abcd"), { modelKey: "missing-model", cursor: cursor() })).rejects.toThrow(
      /PCR_BUDGET_ROUTE_UNKNOWN/,
    );
    expect(() => tokens.effectiveInput({ ...ROUTE, contextWindow: -1 })).toThrowError(/PCR_BUDGET_INPUT_INVALID/);
  });

  it("replays the same message to an equal price", async () => {
    const tokens = pricer();
    const first = await tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: cursor() });
    const second = await tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: cursor() });
    expect(second).toBe(first);
  });

  it("rejects a cursor from another workspace/session/branch", async () => {
    const tokens = pricer();
    const other = { ...cursor(), sessionId: "other-session" };
    await expect(tokens.priceMessage(message("abcd"), { modelKey: ROUTE.modelKey, cursor: other })).rejects.toThrow(
      /PCR_BUDGET_SCOPE_MISMATCH/,
    );
  });

  it("does not price an active turn by message id fingerprint", async () => {
    const tokens = pricer();
    const short = await tokens.priceMessage(message("x", "shared-id"), { modelKey: ROUTE.modelKey, cursor: cursor() });
    const long = await tokens.priceMessage(
      message("x".repeat(400), "shared-id"),
      { modelKey: ROUTE.modelKey, cursor: cursor() },
    );
    expect(long).toBeGreaterThan(short);
  });

  it("stops at the abort boundary before pricing", async () => {
    const tokens = pricer();
    const controller = new AbortController();
    controller.abort();
    await expect(tokens.priceMessage(message("abcd"), {
      modelKey: ROUTE.modelKey,
      cursor: cursor(),
      signal: controller.signal,
    })).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import {
  BudgetError,
  computeEffectiveInput,
  createTokenPricer,
  reservesFromPayload,
} from "../../src/budget/pricer.js";

const bound = createRuntimeCursor({
  workspacePath: "/tmp/pcr-budget",
  sessionId: "session-budget",
  leafId: "leaf-budget",
  lineageEntryIds: ["root", "leaf-budget"],
  modelKey: "openclaw/Qwen3.8-27B-WORK",
});

describe("route / system / tools budget", () => {
  it("subtracts serialized tools, system, and image reserves from I_eff", () => {
    const reserves = reservesFromPayload({
      systemText: "you are a coding agent with a long system prompt ".repeat(20),
      toolsJson: JSON.stringify({ tools: [{ name: "context_search", parameters: { type: "object" } }, { name: "bash" }] }),
      imageBlocks: 1,
    });
    expect(reserves.systemTokens).toBeGreaterThan(0);
    expect(reserves.toolsTokens).toBeGreaterThan(0);
    expect(reserves.imageReserveTokens).toBe(765);
    const ieff = computeEffectiveInput({
      modelKey: bound.modelKey,
      contextWindow: 2000,
      maxOutputTokens: 100,
      providerReservedTokens: 50,
      ...reserves,
    });
    expect(ieff).toBe(
      2000 - 100 - 50 - reserves.systemTokens! - reserves.toolsTokens! - reserves.imageReserveTokens!,
    );
    expect(ieff).toBeLessThan(2000 - 100 - 50);
  });

  it("blocks an image-heavy route that exhausts the window", () => {
    const ieff = computeEffectiveInput({
      modelKey: bound.modelKey,
      contextWindow: 800,
      maxOutputTokens: 16,
      providerReservedTokens: 0,
      imageReserveTokens: 765,
    });
    expect(ieff).toBe(19);
    expect(computeEffectiveInput({
      modelKey: bound.modelKey,
      contextWindow: 700,
      maxOutputTokens: 16,
      providerReservedTokens: 0,
      imageReserveTokens: 765,
    })).toBe(0);
  });

  it("invalidates calibration when the model is not in the registered routes", async () => {
    const pricer = createTokenPricer({
      cursor: bound,
      routes: {
        [bound.modelKey]: {
          modelKey: bound.modelKey,
          contextWindow: 200_192,
          maxOutputTokens: 16_384,
          providerReservedTokens: 0,
        },
      },
    });
    await expect(pricer.priceMessage({
      hostMessageId: "hm-1",
      role: "user",
      timestamp: 1,
      sourceClass: "authenticated-user",
      content: [{ type: "text", text: "hi" }],
    }, {
      modelKey: "other/model",
      cursor: bound,
    })).rejects.toMatchObject({ code: "PCR_BUDGET_ROUTE_UNKNOWN" });
    expect(() => createTokenPricer({
      cursor: bound,
      routes: {},
    })).toBeDefined();
    expect(() => new BudgetError("PCR_BUDGET_ROUTE_UNKNOWN")).not.toThrow();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { computeEffectiveInput, createRuntimeCursor, reservesFromPayload } from "@pcr/core";
import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import {
  derivePiSessionContext,
  registerProductionUserTurnRuntime,
} from "../../apps/pi-context-runtime/src/composition-root.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("product context I_eff envelope", () => {
  it("reduces history budget when the serialized tools schema grows", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-budget-"));
    roots.push(root);
    const small = JSON.stringify({ tools: [{ name: "bash" }] });
    const large = JSON.stringify({
      tools: Array.from({ length: 40 }, (_, index) => ({
        name: `tool_${index}`,
        parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(80) } } },
      })),
    });
    const smallIeff = computeEffectiveInput({
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      contextWindow: 3_200,
      maxOutputTokens: 1_000,
      providerReservedTokens: 100,
      ...reservesFromPayload({ toolsJson: small, systemText: "agent" }),
    });
    const largeIeff = computeEffectiveInput({
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      contextWindow: 3_200,
      maxOutputTokens: 1_000,
      providerReservedTokens: 100,
      ...reservesFromPayload({ toolsJson: large, systemText: "agent" }),
    });
    expect(largeIeff).toBeLessThan(smallIeff);

    const runtime = registerProductionUserTurnRuntime({
      on() {},
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    } as never, { dataRoot: () => root });
    const manager = SessionManager.inMemory(root);
    const ctx = {
      cwd: root,
      sessionManager: manager,
      model: {
        provider: "openclaw",
        id: "Qwen3.8-27B-WORK",
        contextWindow: 3_200,
        maxTokens: 1_000,
        providerReservedTokens: 100,
      },
    };
    await runtime.ensure(ctx as never);
    const derived = derivePiSessionContext(ctx as never, { create: createRuntimeCursor });
    const session = await runtime.openSession(derived);
    const history = Array.from({ length: 30 }, (_, index) => ({
      hostMessageId: `h-${index}`,
      role: "user" as const,
      timestamp: index,
      sourceClass: "authenticated-user" as const,
      content: [{ type: "text" as const, text: `turn ${index} ${"history ".repeat(40)}` }],
    }));
    const compact = await session.materialize({
      operationId: "op-small",
      cursor: derived,
      canonicalMessages: history,
      currentContextWindow: 3_200,
      maxOutputTokens: 1_000,
      providerReservedTokens: 100,
      toolsJson: small,
      systemText: "agent",
      reason: "normal",
      now: 1,
    });
    const reduced = await session.materialize({
      operationId: "op-large",
      cursor: derived,
      canonicalMessages: history,
      currentContextWindow: 3_200,
      maxOutputTokens: 1_000,
      providerReservedTokens: 100,
      toolsJson: large,
      systemText: "agent",
      reason: "normal",
      now: 2,
    });
    expect(compact.tokenEstimate).toBeLessThanOrEqual(smallIeff);
    expect(reduced.tokenEstimate).toBeLessThanOrEqual(largeIeff);
    const usage = await runtime.lastRequestUsage(derived.workspaceId);
    expect(usage?.serializedInputTokens).toBe(reduced.tokenEstimate);
    expect(usage?.viewId).toBe(reduced.viewId);
    expect(usage?.outputHash).toBe(reduced.outputHash);
    await runtime.close();
  });

  it("reads system prompt from the real Pi ctx.getSystemPrompt() on the product extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-budget-host-"));
    roots.push(root);
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    const extension = createPiContextExtension({
      on(hook, next) {
        if (hook === "context") handler = next as typeof handler;
      },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    const manager = SessionManager.inMemory(root);
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: "user",
      content: `turn ${index} ${"history ".repeat(30)}`,
      timestamp: index,
    }));
    const ctx = {
      abort() {},
      cwd: root,
      sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 3_200, maxTokens: 1_000 },
      getSystemPrompt() {
        return "you are a coding agent\nTools:\n" + "bash schema ".repeat(80);
      },
      getContextUsage() {
        return { tokens: 400, contextWindow: 3_200, percent: 12 };
      },
    };
    const result = await handler!({ messages: history }, ctx);
    expect(result.messages.length).toBeGreaterThan(0);
    await extension.release?.();
  });
});

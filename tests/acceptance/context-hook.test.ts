import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { createRuntimeCursor } from "@pcr/core";
import { registerContextHook } from "@pcr/pi-adapter";
import { createRuntimeSessionRegistry } from "@pcr/runtime";

afterEach(resetOwnerForTest);

describe("context hook acceptance", () => {
  it("returns a zone-ordered list from the registry materializer without zero-filling usage", async () => {
    const bound = createRuntimeCursor({
      workspacePath: "/tmp/pcr-accept-context",
      sessionId: "session-accept",
      leafId: "leaf-accept",
      lineageEntryIds: ["root", "leaf-accept"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    registerContextHook(
      { on(_hook, next) { handler = next as typeof handler; } },
      createRuntimeSessionRegistry({
        workspaceId: bound.workspaceId,
        factory: {
          async create() {
            return {
              session: {
                async ingestUserInput() { throw new Error("unused"); },
                async ingestToolResult() { throw new Error("unused"); },
                async materialize() {
                  return {
                    viewId: "vw_accept",
                    outputHash: "a".repeat(64),
                    messages: [
                      {
                        hostMessageId: "hm_user",
                        role: "user",
                        timestamp: 1,
                        sourceClass: "authenticated-user",
                        content: [{ type: "text", text: "now" }],
                      },
                    ],
                    sections: [],
                    tokenEstimate: 1,
                    cachePlan: {
                      layoutVersion: 1,
                      sectionOrder: ["active-turn"],
                      eligiblePrefixTokens: 0,
                      firstDifferentSection: "active-turn",
                      previousViewId: null,
                      providerCapability: "automatic-prefix",
                    },
                    omissions: [],
                  };
                },
              },
              dispose: async () => undefined,
            };
          },
        },
      }),
    );
    const result = await handler!(
      { messages: [{ role: "user", content: "now", timestamp: 1 }] },
      {
        abort() {},
        workspaceId: bound.workspaceId,
        sessionId: bound.sessionId,
        leafId: bound.leafId,
        lineageHash: bound.lineageHash,
        modelKey: bound.modelKey,
        now: 1,
        currentContextWindow: 200_192,
        maxOutputTokens: 16_384,
      },
    );
    expect(result.messages.at(-1)).toMatchObject({ role: "user" });
    expect(result.messages.some((item) => item && typeof item === "object" && "usage" in item)).toBe(false);
  });

  it("createPiContextExtension materializes through T27 and does not rewrite a hook throw to the original list", async () => {
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    const ext = createPiContextExtension({
      on(hook, next) {
        if (hook === "context") handler = next as typeof handler;
      },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    const manager = SessionManager.inMemory("/tmp/pcr-accept-product-context");
    manager.appendMessage({ role: "user", content: "do not deploy production" } as never);
    const result = await handler!({
      messages: [
        { role: "user", content: "do not deploy production", timestamp: 1 },
        { role: "user", content: "now", timestamp: 2 },
      ],
    }, {
      abort() {},
      cwd: manager.getCwd(),
      sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 8000, maxTokens: 1000 },
    });
    expect(result.messages.some((item) => item && typeof item === "object" && "content" in item && (item as { content: unknown }).content === "keep")).toBe(false);
    expect(result.messages.at(-1)).toMatchObject({ role: "user", content: "now" });
    await expect(handler!({ messages: null as never }, {
      abort() {},
      cwd: manager.getCwd(),
      sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK" },
    })).rejects.toThrow(/PCR_CONTEXT_HOOK_INPUT_INVALID/);
    await ext.release?.();
  });
});

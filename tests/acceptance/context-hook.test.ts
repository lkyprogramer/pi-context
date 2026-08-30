import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { registerContextHook } from "@pcr/pi-adapter";
import { createRuntimeSessionRegistry } from "@pcr/runtime";

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
      },
    );
    expect(result.messages.at(-1)).toMatchObject({ role: "user" });
    expect(result.messages.some((item) => item && typeof item === "object" && "usage" in item)).toBe(false);
  });
});

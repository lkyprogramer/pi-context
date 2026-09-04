import { describe, expect, it } from "vitest";
import { bindToolCallGate } from "../../packages/pi-adapter/src/index.js";
import { registerRuntimeTools } from "../../packages/pi-adapter/src/commands/context.js";
import { createRuntimeCursor } from "../../packages/core/src/index.js";
import { createFakePiHost } from "../../packages/testkit/src/fake-pi-host.js";

describe("Pi tool_call gate", () => {
  it("returns a model-visible safe error instead of executing a blocked call", async () => {
    const host = createFakePiHost();
    const seen: unknown[] = [];
    bindToolCallGate(host, {
      authorize: async () => ({ kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING" }),
      onBlocked: (result) => seen.push(result),
    });
    await host.emit("tool_call", { content: { toolName: "deploy", args: { target: "prod" } } });
    expect(seen[0]).toMatchObject({ isError: true, code: "PCR_ACTION_AUTHORITY_MISSING" });
  });

  it("derives sessionId from the host ExtensionContext for runtime tools", async () => {
    const cursor = createRuntimeCursor({ workspacePath: process.cwd(), sessionId: "session-host", leafId: null, lineageEntryIds: ["root"], modelKey: "provider/model" });
    let resolved: { sessionId?: string } | undefined;
    const registered = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    registerRuntimeTools({ registerTool(tool) { registered.set(tool.name, tool); }, registerCommand() {} }, {
      workspaceId: cursor.workspaceId,
      cursor,
      evidence: { async search() { return { hits: [] }; }, async read() { throw new Error("unused"); } } as any,
      resolve: async (ctx) => { resolved = ctx as { sessionId?: string }; return { cursor, evidence: { async search() { return { hits: [] }; }, async read() { throw new Error("unused"); } } as any }; },
    });
    await registered.get("context_search")!.execute("call", { query: "hello" }, undefined, undefined, { sessionManager: { getSessionId: () => "session-host" } });
    expect(resolved?.sessionId).toBe("session-host");
  });
});

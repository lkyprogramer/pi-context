import { describe, expect, it } from "vitest";
import { createRegisteredRuntimeTools, registerRuntimeTools, type ToolsRuntime } from "../src/commands/context.js";

function fixtureRuntime(partial: Partial<ToolsRuntime> = {}): ToolsRuntime {
  return {
    workspaceId: "ws_1",
    encryptionKey: "encryptionKey-must-never-leak",
    evidence: { ev_aaaaaaaa: "exact evidence body ".repeat(20) },
    evidenceWorkspace: { ev_aaaaaaaa: "ws_1" },
    searchIndex: [
      { id: "ev_aaaaaaaa", body: "exact evidence body cache", workspaceId: "ws_1" },
      { id: "ev_bbbbbbbb", body: "other workspace", workspaceId: "ws_2" },
    ],
    claimed: true,
    ...partial,
  };
}

function fixtureCtx() {
  return { workspaceId: "ws_1", sessionId: "s1", channel: "authenticated-user" as const };
}

describe("runtime tools", () => {
  it("returns a bounded exact evidence page and never emits secret metadata", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    const result = await tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa", maxTokens: 256 }, undefined, undefined, fixtureCtx());
    expect(result.content[0]?.text.length).toBeLessThan(2048);
    expect(JSON.stringify(result)).not.toContain("encryptionKey");
  });

  it("rejects invalid IDs and ranges", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_recall.execute("c1", { evidenceId: "nope" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_INVALID_ID",
    });
    await expect(
      tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa", start: 8, end: 1 }, undefined, undefined, fixtureCtx()),
    ).rejects.toMatchObject({ code: "PCR_INVALID_RANGE" });
  });

  it("denies cross-scope recall", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(
      tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa" }, undefined, undefined, { workspaceId: "ws_other" }),
    ).rejects.toMatchObject({ code: "PCR_RETRIEVAL_SCOPE_DENIED" });
  });

  it("bounds search limit and time and rejects regex or SQL", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_search.execute("c1", { query: "SELECT * FROM t" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_SEARCH_UNSAFE",
    });
    await expect(tools.context_search.execute("c1", { query: "/cache.*/i" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_SEARCH_UNSAFE",
    });
    const result = await tools.context_search.execute("c1", { query: "cache", limit: 99, timeoutMs: 5000 }, undefined, undefined, fixtureCtx());
    const body = JSON.parse(result.content[0]?.text ?? "{}") as { limit: number; timeoutMs: number; hits: unknown[] };
    expect(body.limit).toBe(20);
    expect(body.timeoutMs).toBe(250);
    expect(body.hits).toHaveLength(1);
  });

  it("requires authenticated user confirmation to pin", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_pin.execute("c1", { directive: "must keep tests" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_PIN_DENIED",
    });
    await expect(
      tools.context_pin.execute("c1", { directive: "must keep tests", approved: true }, undefined, undefined, {
        ...fixtureCtx(),
        channel: "agent",
      }),
    ).rejects.toMatchObject({ code: "PCR_PIN_DENIED" });
    const pinned = await tools.context_pin.execute("c1", { directive: "must keep tests", approved: true }, undefined, undefined, fixtureCtx());
    expect(JSON.parse(pinned.content[0]?.text ?? "{}")).toMatchObject({ pinned: true });
  });

  it("detects tool name collisions and registers commands", async () => {
    const names: string[] = [];
    const commands: string[] = [];
    const pi = {
      registerTool(tool: { name: string }) {
        if (names.includes(tool.name)) throw new Error(`tool name collision: ${tool.name}`);
        names.push(tool.name);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      hasTool(name: string) {
        return names.includes(name);
      },
    };
    registerRuntimeTools(pi, fixtureRuntime());
    expect(names).toEqual(["context_recall", "context_search", "context_status", "context_pin"]);
    expect(commands).toEqual(["context", "context-doctor", "context-compact"]);
    expect(() => registerRuntimeTools(pi, fixtureRuntime())).toThrow(/collision/);
  });
});

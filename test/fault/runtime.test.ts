import { describe, expect, it } from "vitest";
import { parseConfig, DEFAULT_CONFIG } from "../../src/config.js";
import { applyContext, createPlugin } from "../../src/plugin.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { mapOutbound } from "../../src/pi/source-reader.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";
import { registerSurface } from "../../src/commands.js";
import type { AgentMessage } from "../../src/projection/render.js";
import type { NativeEntry } from "../../src/contracts.js";

const LONG = `${"x".repeat(8000)}DO_NOT_CHANGE_HTTP_PATHS`;

function balancedPlugin() {
  const config = parseConfig({
    ...DEFAULT_CONFIG,
    profile: "balanced",
    fold: {
      ...DEFAULT_CONFIG.fold,
      protectRecentBatches: 1,
      minRemovedTokens: 8,
    },
  });
  return createPlugin(config);
}

function lineage(): NativeEntry[] {
  const entries = [
    userEntry("u0", null, textBlocks("run old")),
    assistantEntry("a0", "u0", [{ type: "toolCall", id: "c0" }], "toolUse"),
    toolResultEntry("r0", "a0", "c0", textBlocks(LONG)),
    userEntry("u1", "r0", textBlocks("run new")),
    assistantEntry("a1", "u1", [{ type: "toolCall", id: "c1" }], "toolUse"),
    toolResultEntry("r1", "a1", "c1", textBlocks("recent-ok")),
  ];
  for (const entry of entries) {
    expect(Object.prototype.hasOwnProperty.call(entry, "toolCallId")).toBe(false);
  }
  const results = entries.filter((entry) => entry.message?.role === "toolResult");
  expect(results).toHaveLength(2);
  expect(results.every((entry) => entry.message?.role === "toolResult")).toBe(true);
  expect(results.every((entry) => typeof entry.message?.toolCallId === "string")).toBe(true);
  expect(mapOutbound(officialMessages(), entries).get(2)?.id).toBe("r0");
  expect(mapOutbound(officialMessages(), entries).get(5)?.id).toBe("r1");
  return entries;
}

function officialMessages(): AgentMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "run old" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c0" }] },
    { role: "toolResult", toolCallId: "c0", content: [{ type: "text", text: LONG }] },
    { role: "user", content: [{ type: "text", text: "run new" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "c1" }] },
    { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "recent-ok" }] },
  ];
}

describe("T20 official-shaped context path", () => {
  it("does not rewrite host messages or inject capsules", () => {
    const state = balancedPlugin();
    const messages: AgentMessage[] = [{ role: "user", content: "hello from host" }];
    const snapshot = structuredClone(messages);
    const out = applyContext(state, messages);
    expect(messages).toEqual(snapshot);
    expect(out).toEqual(messages);
    expect(typeof out[0]?.content === "string" ? out[0].content : "").not.toContain("pctx checkpoint");
  });

  it("maps official toolResult messages without folding observations", () => {
    const state = balancedPlugin();
    const entries = lineage();
    const host = officialMessages();
    const snapshot = structuredClone(host);
    expect(host.every((m) => !Array.isArray(m.content) || m.content.every((b) => !("entryId" in b)))).toBe(true);
    const mapped = mapOutbound(host, entries);
    expect(mapped.get(2)?.id).toBe("r0");
    const out = applyContext(state, host);
    expect(host).toEqual(snapshot);
    const toolOut = out[2];
    const text = Array.isArray(toolOut?.content) ? String(toolOut.content[0]?.text ?? "") : "";
    expect(text).toContain("DO_NOT_CHANGE_HTTP_PATHS");
    expect(text).not.toContain("pctx historical observation");
    const recent = Array.isArray(out[5]?.content) ? String(out[5]?.content[0]?.text ?? "") : "";
    expect(recent).toBe("recent-ok");
    expect(Object.isFrozen(host)).toBe(false);
  });

  it("does not treat unseen originals as previously exposed", () => {
    const state = balancedPlugin();
    const entries = lineage();
    void entries;
    const afterRecentOnly = applyContext(state, officialMessages());
    const oldText = Array.isArray(afterRecentOnly[2]?.content) ? String(afterRecentOnly[2]?.content[0]?.text ?? "") : "";
    expect(oldText).toContain("DO_NOT_CHANGE_HTTP_PATHS");
  });

  it("bindHooks context handler returns undefined and leaves event.messages intact", () => {
    const state = balancedPlugin();
    let handler: ((event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown) | undefined;
    const pi: PiExtensionAPI = {
      on(event, h) {
        if (event === "context") handler = h;
      },
      registerTool() {},
      registerCommand() {},
    };
    bindHooks(pi, state);
    const messages: AgentMessage[] = [{ role: "user", content: "host-owned" }];
    const event = { messages };
    const ctx = {
      cwd: process.cwd(),
      sessionManager: {
        getSessionId: () => "sess-1",
        getLeafId: () => "r1",
        getEntry: (id: string) => lineage().find((e) => e.id === id),
        getEntries: () => lineage(),
      },
    };
    const result = handler?.(event, ctx);
    expect(event.messages[0]?.content).toBe("host-owned");
    expect(result).toBeUndefined();
  });
});

describe("T20 pin command is removed", () => {
  it("/pctx pin notifies unknown command and does not append", async () => {
    const appended: unknown[] = [];
    const notes: string[] = [];
    const entries = [userEntry("e1", null, textBlocks("Keep all legacy HTTP paths unchanged."))];
    const state = createPlugin();
    const pi: PiExtensionAPI & { appendEntry: (t: string, d: unknown) => void } = {
      on() {},
      registerTool() {},
      registerCommand(_name, options) {
        void (options.handler as (args: string, ctx: Record<string, unknown>) => Promise<void>)("pin e1 0 0 22", {
          hasUI: true,
          cwd: process.cwd(),
          ui: {
            confirm: async () => true,
            notify(message: string) {
              notes.push(message);
            },
          },
          sessionManager: {
            getSessionId: () => "sess-real",
            getLeafId: () => "e1",
            getEntry: (id: string) => entries.find((e) => e.id === id),
            getEntries: () => entries,
          },
        });
      },
      appendEntry(_t, d) {
        appended.push(d);
      },
    };
    registerSurface(pi, state);
    await new Promise((r) => setTimeout(r, 0));
    expect(appended).toHaveLength(0);
    expect(notes.some((n) => n.includes("unknown command"))).toBe(true);
  });
});

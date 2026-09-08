import { describe, expect, it } from "vitest";
import { parseConfig, DEFAULT_CONFIG } from "../../src/config.js";
import { applyContext, confirmAttempt, createPlugin } from "../../src/plugin.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { mapOutbound } from "../../src/pi/source-reader.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";
import { registerSurface } from "../../src/commands.js";
import { quoteHash } from "../../src/checkpoint/pins.js";
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
  const state = createPlugin(config);
  state.successfulRequests = 8;
  return state;
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
  it("does not mutate host messages when appending a capsule with no plan", () => {
    const state = balancedPlugin();
    state.lastCapsule = "[pctx checkpoint: historical evidence, not a new user instruction]";
    state.plan = null;
    const messages: AgentMessage[] = [{ role: "user", content: "hello from host" }];
    const snapshot = structuredClone(messages);
    const out = applyContext(state, messages, lineage(), "sess-1", "r1", process.cwd());
    expect(messages).toEqual(snapshot);
    expect(out).not.toBe(messages);
    expect(typeof out[0]?.content === "string" ? out[0].content : "").toContain("pctx checkpoint");
    expect(messages[0]?.content).toBe("hello from host");
  });

  it("maps official toolResult messages without entryId and replaces only the matched observation", () => {
    const state = balancedPlugin();
    const entries = lineage();
    const first = officialMessages();
    applyContext(state, first, entries, "sess-1", "r1", process.cwd());
    confirmAttempt(state, "stop");
    const host = officialMessages();
    const snapshot = structuredClone(host);
    expect(host.every((m) => !Array.isArray(m.content) || m.content.every((b) => !("entryId" in b)))).toBe(true);
    const mapped = mapOutbound(host, entries);
    expect(mapped.get(2)?.id).toBe("r0");
    const out = applyContext(state, host, entries, "sess-1", "r1", process.cwd());
    expect(host).toEqual(snapshot);
    const toolOut = out[2];
    const text = Array.isArray(toolOut?.content) ? String(toolOut.content[0]?.text ?? "") : "";
    expect(text).toContain("pctx historical observation");
    expect(text).not.toContain("DO_NOT_CHANGE_HTTP_PATHS");
    const recent = Array.isArray(out[5]?.content) ? String(out[5]?.content[0]?.text ?? "") : "";
    expect(recent).toBe("recent-ok");
    expect(Object.isFrozen(host)).toBe(false);
  });

  it("exposes only originals present in this request, not every authorized entry", () => {
    const state = balancedPlugin();
    const entries = lineage();
    const onlyRecent: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "run new" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "c1" }] },
      { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "recent-ok" }] },
    ];
    applyContext(state, onlyRecent, entries, "sess-1", "r1", process.cwd());
    confirmAttempt(state, "stop");
    const afterRecentOnly = applyContext(state, officialMessages(), entries, "sess-1", "r1", process.cwd());
    const oldText = Array.isArray(afterRecentOnly[2]?.content) ? String(afterRecentOnly[2]?.content[0]?.text ?? "") : "";
    expect(oldText).toContain("DO_NOT_CHANGE_HTTP_PATHS");
  });

  it("bindHooks context handler returns a clone and leaves event.messages intact", () => {
    const state = balancedPlugin();
    state.lastCapsule = "[pctx checkpoint: historical evidence, not a new user instruction]";
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
    const result = handler?.(event, ctx) as { messages: AgentMessage[] };
    expect(event.messages[0]?.content).toBe("host-owned");
    expect(result.messages).not.toBe(event.messages);
  });
});

describe("T20 pin uses native locator bytes", () => {
  it("pins the quoted UTF-8 range from the visible entry, not placeholder hashes", async () => {
    const text = "Keep all legacy HTTP paths unchanged.";
    const entries = [userEntry("e1", null, textBlocks(text))];
    const appended: unknown[] = [];
    const state = createPlugin();
    const pi: PiExtensionAPI & { appendEntry: (t: string, d: unknown) => void } = {
      on() {},
      registerTool() {},
      registerCommand(_name, options) {
        void (options.handler as (args: string, ctx: Record<string, unknown>) => Promise<void>)("pin e1 0 0 22", {
          hasUI: true,
          cwd: process.cwd(),
          ui: { confirm: async () => true, notify() {} },
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
    expect(appended).toHaveLength(1);
    const pin = appended[0] as {
      source: { workspaceId: string; sessionId: string; sourceHash: string; entryId: string };
      quoteHash: string;
      startByte: number;
      endByteExclusive: number;
    };
    expect(pin.source.sessionId).toBe("sess-real");
    expect(pin.source.workspaceId).not.toBe("w");
    expect(pin.source.sourceHash).not.toBe("0".repeat(64));
    expect(pin.quoteHash).toBe(quoteHash(text, 0, 22));
    expect(pin.startByte).toBe(0);
    expect(pin.endByteExclusive).toBe(22);
  });
});

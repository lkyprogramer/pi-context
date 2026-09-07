import type { PluginState } from "./plugin.js";
import { historyTool, setProfile } from "./plugin.js";
import type { HistoryRequest, Profile } from "./contracts.js";
import { PIN_TYPE, pinId, quoteHash } from "./checkpoint/pins.js";
import { decodeRef } from "./history/refs.js";
import { entriesFromCtx, type PiExtensionAPI } from "./pi/adapter.js";

const HISTORY_PARAMS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["search", "read"] },
    query: { type: "string" },
    limit: { type: "integer" },
    cursor: { type: ["string", "null"] },
    ref: { type: "string" },
    maxTokens: { type: "integer" },
  },
  required: ["action"],
};

export function registerSurface(pi: PiExtensionAPI, state: PluginState): void {
  pi.registerTool({
    name: "pctx_history",
    label: "History",
    description: "Search or read authorized native history. Cannot select workspace or branch.",
    parameters: HISTORY_PARAMS,
    async execute(_id: string, params: Record<string, unknown>, _signal: unknown, _upd: unknown, ctx: Record<string, unknown>) {
      const extra = Object.keys(params).filter((k) => !["action", "query", "limit", "cursor", "ref", "maxTokens"].includes(k));
      if (extra.length || "workspace" in params || "session" in params) {
        return { content: [{ type: "text", text: JSON.stringify({ code: "denied", diagnostic: "unknown field" }) }] };
      }
      const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
      const req = params as unknown as HistoryRequest;
      const result = historyTool(state, req, entries, cwd, sessionId, leafId);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  pi.registerCommand("pctx", {
    description: "pi-context native-first controls",
    handler: async (args: string, ctx: Record<string, unknown>) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      const ui = ctx.ui as { notify?: (m: string, t?: string) => void; confirm?: (t: string, m: string) => Promise<boolean> } | undefined;
      const notify = (m: string) => ui?.notify?.(m, "info");
      if (!cmd || cmd === "status") {
        notify(`profile=${state.profile} generation=${state.generation} requests=${state.successfulRequests}`);
        return;
      }
      if (cmd === "doctor") {
        notify(`private:true host=official-pi profile=${state.profile}`);
        return;
      }
      if (cmd === "profile") {
        const next = rest[0] as Profile;
        if (next === "experimental-semantic") {
          notify("experimental-semantic unsupported until T17/T18");
          return;
        }
        if (next === "off" || next === "observe" || next === "balanced") {
          setProfile(state, next);
          notify(`profile set to ${next}; generation bumped`);
        }
        return;
      }
      if (cmd === "export") {
        notify(JSON.stringify({ profile: state.profile, generation: state.generation, content: undefined }));
        return;
      }
      if (cmd === "pin") {
        if (!ctx.hasUI) {
          notify("pin requires an interactive confirmation; not forged");
          return;
        }
        const ok = await ui?.confirm?.("Pin source", "Pin the selected native text range?") ?? false;
        if (!ok) return;
        const [entryId, block, start, end] = rest;
        const append = (pi as { appendEntry?: (t: string, d: unknown) => void }).appendEntry;
        if (append && entryId) {
          const startByte = Number(start);
          const endByte = Number(end);
          append(PIN_TYPE, {
            pinId: pinId({ version: 5, workspaceId: "w", sessionId: "s", entryId, field: { kind: "text", blockIndex: Number(block) }, sourceHash: "0".repeat(64) }, startByte, endByte),
            source: { version: 5, workspaceId: "w", sessionId: "s", entryId, field: { kind: "text", blockIndex: Number(block) }, sourceHash: "0".repeat(64) },
            startByte,
            endByteExclusive: endByte,
            quoteHash: quoteHash("x", 0, 1),
            createdByEntryId: entryId,
            state: "active",
          });
        }
        return;
      }
      if (cmd === "unpin") {
        const append = (pi as { appendEntry?: (t: string, d: unknown) => void }).appendEntry;
        append?.(PIN_TYPE, { pinId: rest[0], state: "released" });
      }
    },
  });
}

export { decodeRef };

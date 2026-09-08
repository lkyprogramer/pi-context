import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PluginState } from "./plugin.js";
import { historyTool, setProfile } from "./plugin.js";
import type { HistoryRequest, NativeEntry, StatusView } from "./contracts.js";
import { utf8Slice } from "./contracts.js";
import { PIN_TYPE, pinId, quoteHash, type Pin } from "./checkpoint/pins.js";
import { textSourceHash } from "./history/refs.js";
import { authorize, buildScope } from "./history/scope.js";
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

export function buildPinRecord(input: {
  cwd: string;
  sessionId: string;
  leafId: string | null;
  entries: NativeEntry[];
  entryId: string;
  blockIndex: number;
  startByte: number;
  endByteExclusive: number;
}): { pin: Pin } | { error: string } {
  const getEntry = (id: string) => input.entries.find((entry) => entry.id === id);
  const scope = buildScope({ cwd: input.cwd, sessionId: input.sessionId, leafId: input.leafId, getEntry });
  if (!authorize(scope, input.entryId)) return { error: "not visible" };
  const entry = getEntry(input.entryId);
  if (!entry) return { error: "source-missing" };
  const raw = entry.message?.content;
  const blocks = Array.isArray(raw) ? raw : typeof raw === "string" ? [{ type: "text", text: raw }] : [];
  const block = blocks[input.blockIndex];
  if (!block || block.type !== "text" || typeof block.text !== "string") return { error: "missing text block" };
  try {
    utf8Slice(block.text, input.startByte, input.endByteExclusive);
  } catch {
    return { error: "invalid-range" };
  }
  const source = {
    version: 5 as const,
    workspaceId: scope.workspaceId,
    sessionId: scope.sessionId,
    entryId: input.entryId,
    field: { kind: "text" as const, blockIndex: input.blockIndex },
    sourceHash: textSourceHash(block.text),
  };
  return {
    pin: {
      pinId: pinId(source, input.startByte, input.endByteExclusive),
      source,
      startByte: input.startByte,
      endByteExclusive: input.endByteExclusive,
      quoteHash: quoteHash(block.text, input.startByte, input.endByteExclusive),
      createdByEntryId: input.entryId,
      state: "active",
    },
  };
}

export function buildStatusView(state: PluginState, ctx: ExtensionContext): StatusView {
  const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  const index = state.index.status();
  const warnings = [...state.warnings, ...index.warnings];
  return {
    resolvedProfile: state.profile,
    configHash: state.configHash,
    configSource: state.configSource,
    warnings,
    hostVersion: state.hostVersion,
    contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
    contextPercent: usage?.percent ?? null,
    activePlan: null,
    folds: 0,
    nativeCompactions: state.nativeCompactions,
    historyReads: state.historyReads,
    historySearches: state.historySearches,
    lastRequests: [],
    indexMode: index.mode,
    dbPath: index.dbPath,
    indexRows: index.rows,
    indexBytes: index.bytes,
    lastIndexedLeaf: index.lastIndexedLeaf,
  };
}

export function formatStatus(view: StatusView): string {
  const warnings = view.warnings.length > 0 ? view.warnings.join(",") : "none";
  return [
    `profile=${view.resolvedProfile}`,
    `resolvedProfile=${view.resolvedProfile}`,
    `configHash=${view.configHash}`,
    `configSource=${view.configSource}`,
    `warnings=${warnings}`,
    `hostVersion=${view.hostVersion}`,
    `contextWindow=${view.contextWindow ?? "null"}`,
    `contextPercent=${view.contextPercent ?? "null"}`,
    `activePlan=null`,
    `folds=${view.folds}`,
    `nativeCompactions=${view.nativeCompactions}`,
    `historyReads=${view.historyReads}`,
    `historySearches=${view.historySearches}`,
    `indexMode=${view.indexMode}`,
    `dbPath=${view.dbPath ?? "null"}`,
    `indexRows=${view.indexRows}`,
    `indexBytes=${view.indexBytes}`,
    `lastIndexedLeaf=${view.lastIndexedLeaf ?? "null"}`,
  ].join(" ");
}

export function registerSurface(pi: PiExtensionAPI, state: PluginState): void {
  pi.registerTool({
    name: "pctx_history",
    label: "History",
    description: "Search or read authorized native history. Cannot select workspace or branch.",
    parameters: HISTORY_PARAMS,
    async execute(_id: string, params: Record<string, unknown>, _signal: unknown, _upd: unknown, ctx: ExtensionContext) {
      const extra = Object.keys(params).filter((k) => !["action", "query", "limit", "cursor", "ref", "maxTokens"].includes(k));
      if (extra.length || "workspace" in params || "session" in params) {
        return { content: [{ type: "text", text: JSON.stringify({ code: "denied", diagnostic: "unknown field" }) }] };
      }
      const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
      const req = params as unknown as HistoryRequest;
      const result = await historyTool(state, req, entries, cwd, sessionId, leafId);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  } as never);

  pi.registerCommand("pctx", {
    description: "pi-context native-first controls",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      const notify = (m: string) => ctx.ui.notify(m, "info");
      if (!cmd || cmd === "status") {
        notify(formatStatus(buildStatusView(state, ctx)));
        return;
      }
      if (cmd === "doctor") {
        notify(`private:true host=official-pi profile=${state.profile}`);
        return;
      }
      if (cmd === "profile") {
        const next = rest[0];
        if (next === "off" || next === "observe" || next === "balanced") {
          setProfile(state, next);
          notify(`profile set to ${next} in memory; will not write the config file`);
        } else {
          notify("profile must be off, observe, or balanced");
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
        const ok = (await ctx.ui.confirm("Pin source", "Pin the selected native text range?")) ?? false;
        if (!ok) return;
        const [entryId, block, start, end] = rest;
        const append = pi.appendEntry;
        if (append && entryId) {
          const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
          const built = buildPinRecord({
            cwd,
            sessionId,
            leafId,
            entries,
            entryId,
            blockIndex: Number(block),
            startByte: Number(start),
            endByteExclusive: Number(end),
          });
          if ("error" in built) {
            notify(built.error);
            return;
          }
          append(PIN_TYPE, built.pin);
        }
        return;
      }
      if (cmd === "unpin") {
        pi.appendEntry?.(PIN_TYPE, { pinId: rest[0], state: "released" });
      }
    },
  });
}

export { decodeRef };

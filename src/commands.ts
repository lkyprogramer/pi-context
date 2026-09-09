import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HistoryRequest, StatusView } from "./contracts.js";
import type { PluginState } from "./plugin.js";
import { historyTool, indexBranch, setProfile } from "./plugin.js";
import { statusView, writeStatusFile } from "./telemetry/metrics.js";
import { viewFromEntries } from "./projection/active-view.js";
import { collectBatches } from "./projection/batches.js";
import { exposedEntryIds } from "./projection/exposed.js";
import { planFold } from "./projection/planner.js";
import { decodeRef } from "./history/refs.js";
import { formatHistoryResult } from "./history/read.js";
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

export function buildStatusView(state: PluginState, ctx: ExtensionContext): StatusView {
  return statusView(state, ctx);
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
    `activePlan=${view.activePlan ? `${view.activePlan.planId}:${view.activePlan.replacements}` : "null"}`,
    `folds=${view.folds}`,
    `nativeCompactions=${view.nativeCompactions}`,
    `historyReads=${view.historyReads}`,
    `historySearches=${view.historySearches}`,
    `verifiedReads=${view.verifiedReads}`,
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
      const usageRaw = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
      const contextWindow = usageRaw?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      const usage = usageRaw || contextWindow
        ? {
            tokens: usageRaw?.tokens ?? null,
            contextWindow,
            percent: usageRaw?.percent ?? null,
          }
        : null;
      const result = await historyTool(state, req, entries, cwd, sessionId, leafId, usage);
      return formatHistoryResult(result);
    },
  } as never);

  pi.registerCommand("pctx", {
    description: "pi-context native-first controls",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      const notify = (m: string) => ctx.ui.notify(m, "info");
      if (!cmd || cmd === "status") {
        const view = buildStatusView(state, ctx);
        writeStatusFile(state, ctx);
        if (rest[0] === "--json") notify(JSON.stringify(view));
        else notify(formatStatus(view));
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
        notify(JSON.stringify({ profile: state.profile, content: undefined }));
        return;
      }
      if (cmd === "search" || cmd === "read") {
        notify("use the pctx_history tool for search and read");
        return;
      }
      if (cmd === "fold") {
        const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
        indexBranch(state, entries, cwd, sessionId, leafId);
        if (!state.scope) {
          notify("fold requires an active session scope");
          return;
        }
        const usageRaw = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
        const usage = {
          tokens: usageRaw?.tokens ?? null,
          contextWindow: usageRaw?.contextWindow ?? ctx.model?.contextWindow ?? 0,
          percent: usageRaw?.percent ?? null,
        };
        const view = viewFromEntries(state.scope, entries);
        const next = planFold({
          scope: state.scope,
          view,
          batches: collectBatches(view.branch),
          exposed: exposedEntryIds(view.branch),
          usage,
          previous: state.plan,
          modelId: ctx.model?.id ?? state.modelId,
          cfg: state.config,
          configHash: state.configHash,
        });
        if (!next || next === state.plan) {
          notify("fold not applied");
          return;
        }
        state.plan = next;
        notify(`fold plan ${next.planId} replacements=${next.replacements.size}`);
        return;
      }
      notify("unknown command; pctx commands: status|profile|search|read");
    },
  });
}

export { decodeRef };

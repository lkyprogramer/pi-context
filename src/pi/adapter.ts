import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
  acceptAssistantWitness,
  applyContext,
  applyConfigFailure,
  applyLoadedConfig,
  closeSessionIndex,
  createPlugin,
  fenceIdentity,
  historyTool,
  indexBranch,
  noteNativeCompact,
  observeProviderRequest,
  openSessionIndex,
  setProfile,
  type PluginState,
} from "../plugin.js";
import { loadConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { NativeEntry } from "../contracts.js";
import { recordAssistant, writeStatusFile } from "../telemetry/metrics.js";
import { recordRequest } from "../telemetry/usage.js";
import type { AgentMessage } from "../projection/render.js";
import { sessionSnapshot, type SessionReader } from "./source-reader.js";

export type PiExtensionAPI = ExtensionAPI;

function hostVersionFromRequire(from: string): string | null {
  try {
    const req = createRequire(from);
    const version = String(req("@earendil-works/pi-coding-agent/package.json").version ?? "");
    return version || null;
  } catch {
    return null;
  }
}

export function readHostVersion(): string {
  const fromPlugin = hostVersionFromRequire(import.meta.url);
  if (fromPlugin) return fromPlugin;
  const fromCwd = hostVersionFromRequire(join(process.cwd(), "package.json"));
  if (fromCwd) return fromCwd;
  const initCwd = process.env.INIT_CWD?.trim();
  if (initCwd) {
    const fromInit = hostVersionFromRequire(join(initCwd, "package.json"));
    if (fromInit) return fromInit;
  }
  const starts = [process.argv[1], fileURLToPath(import.meta.url)].filter((p): p is string => Boolean(p));
  for (const start of starts) {
    let dir = dirname(start);
    for (let i = 0; i < 12 && dir; i++) {
      const candidates = [join(dir, "package.json"), join(dir, "node_modules/@earendil-works/pi-coding-agent/package.json")];
      for (const pkgPath of candidates) {
        if (!existsSync(pkgPath)) continue;
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
          if (pkg.name === "@earendil-works/pi-coding-agent" && pkg.version) return pkg.version;
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const fromEnv = process.env.PCTX_HOST_VERSION?.trim();
  if (fromEnv) return fromEnv;
  return "unknown";
}

function projectTrustedOf(ctx: ExtensionContext): boolean {
  return typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
}

export function entriesFromCtx(ctx: ExtensionContext): {
  entries: NativeEntry[];
  sessionId: string;
  leafId: string | null;
  cwd: string;
} {
  return sessionSnapshot({
    cwd: ctx.cwd,
    sessionManager: ctx.sessionManager as unknown as SessionReader | undefined,
  });
}

export function bindHooks(pi: PiExtensionAPI, state: PluginState = createPlugin(DEFAULT_CONFIG)): PluginState {
  const hostVersion = readHostVersion();
  state.hostVersion = hostVersion;
  pi.on("session_start", (_e, ctx) => {
    try {
      applyLoadedConfig(state, loadConfig(ctx.cwd, projectTrustedOf(ctx)));
    } catch (err) {
      applyConfigFailure(state, err);
      ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
    }
    state.hostVersion = hostVersion;
    state.modelId = ctx.model?.id ?? "unknown";
    const provider = (ctx.model as { provider?: string } | undefined)?.provider;
    if (typeof provider === "string") state.provider = provider;
    fenceIdentity(state);
    const agentDir = (ctx as { agentDir?: string }).agentDir;
    if (typeof agentDir === "string") state.agentDir = agentDir;
    openSessionIndex(state);
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    state.sessionId = sessionId;
    indexBranch(state, entries, cwd, sessionId, leafId);
  });
  pi.on("context", ((event: { messages?: AgentMessage[] }, ctx: ExtensionContext) => {
    const messages = event.messages;
    if (!Array.isArray(messages)) return undefined;
    return applyContext(state, messages, ctx);
  }) as never);
  pi.on("tool_result", (_e, ctx) => {
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    indexBranch(state, entries, cwd, sessionId, leafId);
  });
  pi.on("before_provider_request", ((event: { payload?: unknown }) => {
    observeProviderRequest(state, event.payload);
    return undefined;
  }) as never);
  pi.on("message_start", () => {
    state.ttftStartedAt = Date.now();
    state.ttftMs = null;
    state.sawMessageUpdate = false;
  });
  pi.on("message_update", () => {
    if (state.sawMessageUpdate || state.ttftStartedAt == null) return;
    state.ttftMs = Date.now() - state.ttftStartedAt;
    state.sawMessageUpdate = true;
  });
  pi.on("message_end", (event: MessageEndEvent, ctx) => {
    const msg = event.message as {
      role?: string;
      stopReason?: string;
      errorMessage?: string;
      usage?: AssistantUsageLike;
      responseId?: unknown;
      id?: unknown;
    };
    if (msg.role !== "assistant") return;
    state.lastAssistant = recordAssistant(msg);
    acceptAssistantWitness(state, msg);
    const { sessionId } = entriesFromCtx(ctx);
    recordRequest(state, {
      at: new Date().toISOString(),
      sessionId,
      profile: state.profile,
      planId: state.plan?.planId ?? null,
      replacementsApplied: state.lastApplied,
      contextPercentBefore: state.lastContextPercent,
      usage: {
        input: numOrNull(msg.usage?.input),
        output: numOrNull(msg.usage?.output),
        cacheRead: numOrNull(msg.usage?.cacheRead),
        cacheWrite: numOrNull(msg.usage?.cacheWrite),
        totalTokens: numOrNull(msg.usage?.totalTokens),
      },
      stopReason: typeof msg.stopReason === "string" ? msg.stopReason : null,
      ttftMs: state.sawMessageUpdate ? state.ttftMs : null,
    });
  });
  pi.on("session_compact", (event: SessionCompactEvent) => {
    noteNativeCompact(state, event.willRetry !== true);
  });
  pi.on("session_tree", () => {
    fenceIdentity(state);
  });
  pi.on("model_select", (event: { model?: { id?: string; provider?: string } }) => {
    fenceIdentity(state);
    if (event?.model?.id) state.modelId = event.model.id;
    if (event?.model?.provider) state.provider = event.model.provider;
  });
  pi.on("session_shutdown", (_e, ctx) => {
    writeStatusFile(state, ctx);
    closeSessionIndex(state);
    state.plan = null;
  });
  pi.on("agent_end" as never, (_e: unknown, ctx: ExtensionContext) => {
    writeStatusFile(state, ctx);
  });
  pi.on("agent_settled", (_e, ctx) => {
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    indexBranch(state, entries, cwd, sessionId, leafId);
  });
  return state;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type AssistantUsageLike = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
};

export { historyTool, setProfile };

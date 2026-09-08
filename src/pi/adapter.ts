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
  applyConfigFailure,
  applyLoadedConfig,
  applyContext,
  closeSessionIndex,
  confirmAttempt,
  createPlugin,
  historyTool,
  indexBranch,
  noteCompactFailed,
  noteFence,
  noteNativeCompact,
  openSessionIndex,
  restoreStagingFromEntries,
  setProfile,
  type PluginState,
} from "../plugin.js";
import { loadConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { NativeEntry } from "../contracts.js";
import { recordAssistant } from "../telemetry/metrics.js";
import { readVisibleSnapshot, type SessionReader } from "./source-reader.js";

export type PiExtensionAPI = ExtensionAPI;

export function readHostVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    return String(req("@earendil-works/pi-coding-agent/package.json").version);
  } catch {
    /* packed extension may not depend on the host package */
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
  const sm = ctx.sessionManager as unknown as SessionReader | undefined;
  const cwd = ctx.cwd || process.cwd();
  if (!sm) return { entries: [], sessionId: "unknown", leafId: null, cwd };
  const sessionId = sm.getSessionId();
  const leafId = sm.getLeafId();
  const entries = typeof sm.getEntries === "function" ? [...(sm.getEntries() as NativeEntry[])] : readVisibleSnapshot(sm);
  return { entries, sessionId, leafId, cwd };
}

export function bindHooks(pi: PiExtensionAPI, state: PluginState = createPlugin(DEFAULT_CONFIG)): PluginState {
  pi.on("session_start", (_e, ctx) => {
    try {
      applyLoadedConfig(state, loadConfig(ctx.cwd, projectTrustedOf(ctx)));
    } catch (err) {
      applyConfigFailure(state, err);
      ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
    }
    state.hostVersion = readHostVersion();
    openSessionIndex(state);
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    indexBranch(state, entries, cwd, sessionId, leafId);
    restoreStagingFromEntries(state, entries);
  });
  pi.on("context", (event, ctx) => {
    const messages = event.messages ?? [];
    try {
      const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
      const next = applyContext(state, messages as never, entries, sessionId, leafId, cwd);
      return { messages: next as unknown as typeof messages };
    } catch {
      return { messages };
    }
  });
  pi.on("tool_result", (_e, ctx) => {
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    indexBranch(state, entries, cwd, sessionId, leafId);
  });
  pi.on("before_provider_request", () => undefined);
  pi.on("session_before_compact", () => undefined);
  pi.on("message_end", (event: MessageEndEvent) => {
    const msg = event.message as { stopReason?: string; errorMessage?: string; usage?: AssistantUsageLike };
    state.lastAssistant = recordAssistant(msg);
    confirmAttempt(state, msg.stopReason, msg.errorMessage);
  });
  pi.on("session_compact", (event: SessionCompactEvent, ctx) => {
    if (event.willRetry) return;
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    const entry = event.compactionEntry;
    noteNativeCompact(state, String(entry?.summary ?? ""), String(entry?.id ?? "compact"), entries, sessionId, leafId, cwd);
    state.nativeCompactions += 1;
  });
  pi.on("session_compact_failed", () => {
    noteCompactFailed(state);
  });
  pi.on("session_tree", () => {
    noteFence(state);
  });
  pi.on("model_select", () => {
    noteFence(state);
  });
  pi.on("session_shutdown", () => {
    closeSessionIndex(state);
    state.plan = null;
  });
  pi.on("agent_settled", (_e, ctx) => {
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    indexBranch(state, entries, cwd, sessionId, leafId);
  });
  return state;
}

type AssistantUsageLike = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
};

export { historyTool, setProfile };

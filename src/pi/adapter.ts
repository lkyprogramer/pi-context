import { applyContext, confirmAttempt, createPlugin, historyTool, noteCompactFailed, noteFence, noteNativeCompact, setProfile, type PluginState } from "../plugin.js";
import { shouldGenerateSemantic } from "../checkpoint/semantic.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { NativeEntry } from "../contracts.js";
import { readVisibleSnapshot, type SessionReader } from "./source-reader.js";

export interface PiExtensionAPI {
  on(event: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: Record<string, unknown>): void;
  appendEntry?(customType: string, data?: unknown): void;
}

export function entriesFromCtx(ctx: Record<string, unknown>): { entries: NativeEntry[]; sessionId: string; leafId: string | null; cwd: string } {
  const sm = ctx.sessionManager as SessionReader | undefined;
  const cwd = String(ctx.cwd ?? process.cwd());
  if (!sm) return { entries: [], sessionId: "unknown", leafId: null, cwd };
  const sessionId = sm.getSessionId();
  const leafId = sm.getLeafId();
  const entries = typeof sm.getEntries === "function" ? [...sm.getEntries()] : readVisibleSnapshot(sm);
  return { entries, sessionId, leafId, cwd };
}

export function bindHooks(pi: PiExtensionAPI, state: PluginState = createPlugin(DEFAULT_CONFIG)): PluginState {
  pi.on("session_start", (_e, ctx) => {
    const { entries } = entriesFromCtx(ctx);
    for (const _ of entries) {
      /* rebuild cursors only */
    }
  });
  pi.on("context", (event, ctx) => {
    const messages = (event.messages as never[]) ?? [];
    try {
      const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
      const next = applyContext(state, messages as never, entries, sessionId, leafId, cwd);
      return { messages: next };
    } catch {
      return { messages };
    }
  });
  pi.on("tool_result", () => undefined);
  pi.on("before_provider_request", () => undefined);
  pi.on("session_before_compact", () => {
    if (!shouldGenerateSemantic(state.profile, state.config.semantic.enabled)) return undefined;
    return undefined;
  });
  pi.on("message_end", (event) => {
    const msg = event.message as { stopReason?: string; errorMessage?: string } | undefined;
    confirmAttempt(state, msg?.stopReason, msg?.errorMessage);
  });
  pi.on("session_compact", (event, ctx) => {
    const { entries, sessionId, leafId, cwd } = entriesFromCtx(ctx);
    const entry = event.entry as { id?: string; summary?: string } | undefined;
    noteNativeCompact(state, String(entry?.summary ?? ""), String(entry?.id ?? "compact"), entries, sessionId, leafId, cwd);
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
    state.plan = null;
  });
  pi.on("agent_settled", () => {
    /* drain lightweight index only */
  });
  return state;
}

export { historyTool, setProfile };

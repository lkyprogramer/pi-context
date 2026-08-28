import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiContextRuntime } from "@pi-context-runtime/pi-adapter";

export default async function register(pi: ExtensionAPI): Promise<void> {
  const runtime = createPiContextRuntime();

  pi.on("session_start", (event, ctx) => runtime.onSessionStart(event, ctx));
  pi.on("session_shutdown", (event, ctx) => runtime.onSessionShutdown(event, ctx));
  pi.on("input", (event, ctx) => runtime.onInput(event, ctx));
  pi.on("before_agent_start", (event, ctx) => runtime.onBeforeAgentStart(event, ctx));
  pi.on("context", (event, ctx) => runtime.onContext(event, ctx));
  pi.on("tool_call", (event, ctx) => runtime.onToolCall(event, ctx));
  pi.on("tool_result", (event, ctx) => runtime.onToolResult(event, ctx));
  pi.on("message_end", (event, ctx) => runtime.onMessageEnd(event, ctx));
  pi.on("turn_end", (event, ctx) => runtime.onTurnEnd(event, ctx));
  pi.on("agent_settled", (event, ctx) => runtime.onAgentSettled(event, ctx));
  pi.on("session_before_compact", (event, ctx) => runtime.onBeforeCompact(event, ctx));
  pi.on("session_compact", (event, ctx) => runtime.onCompacted(event, ctx));
  pi.on("session_compact_failed", (event, ctx) => runtime.onCompactFailed(event, ctx));
  pi.on("session_tree", (event, ctx) => runtime.onSessionTree(event, ctx));

  runtime.registerToolsAndCommands(pi);
}

import type {
  Pi0844ContextEvent,
  Pi0844ExtensionAPI,
  Pi0844MessageEndEvent,
  Pi0844ModelSelectEvent,
  Pi0844SessionBeforeCompactEvent,
  Pi0844SessionCompactEvent,
  Pi0844SessionCompactFailedEvent,
  Pi0844SessionShutdownEvent,
  Pi0844SessionStartEvent,
  Pi0844SessionTreeEvent,
  Pi0844ToolResultEvent,
  PiCapabilities,
} from "../../packages/pi-adapter/src/contracts/pi-0844.js";

export const expectedCapabilities: PiCapabilities = {
  context: true,
  toolResult: true,
  compaction: true,
  lifecycle: true,
};

export function compilePi0844Handlers(pi: Pi0844ExtensionAPI): void {
  pi.on("context", (_event: Pi0844ContextEvent) => undefined);
  pi.on("tool_result", (_event: Pi0844ToolResultEvent) => undefined);
  pi.on("session_before_compact", (_event: Pi0844SessionBeforeCompactEvent) => undefined);
  pi.on("session_compact", (_event: Pi0844SessionCompactEvent) => undefined);
  pi.on("session_compact_failed", (_event: Pi0844SessionCompactFailedEvent) => undefined);
  pi.on("session_start", (_event: Pi0844SessionStartEvent) => undefined);
  pi.on("session_tree", (_event: Pi0844SessionTreeEvent) => undefined);
  pi.on("session_shutdown", (_event: Pi0844SessionShutdownEvent) => undefined);
  pi.on("message_end", (_event: Pi0844MessageEndEvent) => undefined);
  pi.on("model_select", (_event: Pi0844ModelSelectEvent) => undefined);
}

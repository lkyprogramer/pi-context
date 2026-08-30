import {
  VERSION,
  discoverAndLoadExtensions,
  type AgentSettledEvent,
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionEvent,
  type InputEvent,
  type InputResultEvent,
  type MessageEndEvent,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionTreeEvent,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

export type Pi0844ExtensionAPI = ExtensionAPI;
export type Pi0844ContextEvent = ContextEvent;
export type Pi0844ToolResultEvent = ToolResultEvent;
export type Pi0844SessionBeforeCompactEvent = SessionBeforeCompactEvent;
export type Pi0844SessionCompactEvent = SessionCompactEvent;
export type Pi0844SessionCompactFailedEvent = Extract<ExtensionEvent, { type: "session_compact_failed" }>;
export type Pi0844SessionStartEvent = SessionStartEvent;
export type Pi0844SessionTreeEvent = SessionTreeEvent;
export type Pi0844SessionShutdownEvent = SessionShutdownEvent;
export type Pi0844InputEvent = InputEvent;
export type Pi0844InputResultEvent = InputResultEvent;
export type Pi0844MessageEndEvent = MessageEndEvent;
export type Pi0844ModelSelectEvent = Extract<ExtensionEvent, { type: "model_select" }>;
export type Pi0844AgentSettledEvent = AgentSettledEvent;

export interface PiCapabilities {
  context: true;
  toolResult: true;
  compaction: true;
  lifecycle: true;
}

export const PI_0844_REQUIRED_HOOKS = [
  "agent_settled",
  "context",
  "input",
  "input_result",
  "message_end",
  "model_select",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_shutdown",
  "session_start",
  "session_tree",
  "tool_result",
] as const;

export interface Pi0844ProbeInput {
  expectedVersion: string;
  cwd: string;
  extensionPath: string;
  signal?: AbortSignal;
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Pi public API probe aborted", "AbortError");
}

export function registerPi0844ContractHandlers(pi: ExtensionAPI): void {
  pi.on("context", () => undefined);
  pi.on("tool_result", () => undefined);
  pi.on("session_before_compact", () => undefined);
  pi.on("session_compact", () => undefined);
  pi.on("session_compact_failed", () => undefined);
  pi.on("session_start", () => undefined);
  pi.on("session_tree", () => undefined);
  pi.on("session_shutdown", () => undefined);
  pi.on("input", () => undefined);
  pi.on("input_result", () => undefined);
  pi.on("message_end", () => undefined);
  pi.on("model_select", () => undefined);
  pi.on("agent_settled", () => undefined);
}

export function createPi0844HookFixtures(): {
  context: ContextEvent;
  toolResult: ToolResultEvent;
  sessionStart: SessionStartEvent;
  sessionTree: SessionTreeEvent;
} {
  return {
    context: { type: "context", messages: [] },
    toolResult: {
      type: "tool_result",
      toolName: "pcr_contract_probe",
      toolCallId: "call-contract",
      input: { probe: true },
      content: [{ type: "text", text: "contract" }],
      isError: false,
      details: { source: "contract" },
    },
    sessionStart: { type: "session_start", reason: "startup" },
    sessionTree: { type: "session_tree", oldLeafId: "entry-old", newLeafId: "entry-new" },
  };
}

export async function probePi0844PublicApi(input: Pi0844ProbeInput): Promise<{
  version: string;
  ready: boolean;
  handlers: string[];
  missing: string[];
  capabilities: Record<keyof PiCapabilities, boolean>;
}> {
  if (!input || typeof input !== "object") throw new TypeError("Pi probe input is required");
  if (typeof input.cwd !== "string" || input.cwd.length === 0) throw new TypeError("cwd is required");
  if (typeof input.extensionPath !== "string" || input.extensionPath.length === 0) {
    throw new TypeError("extensionPath is required");
  }
  if (typeof input.expectedVersion !== "string" || input.expectedVersion.length === 0) {
    throw new TypeError("expectedVersion is required");
  }
  if (VERSION !== input.expectedVersion) {
    throw new Error(`expected Pi ${input.expectedVersion} but loaded ${VERSION}`);
  }
  abortIfRequested(input.signal);
  const loaded = await discoverAndLoadExtensions([input.extensionPath], input.cwd);
  abortIfRequested(input.signal);
  if (loaded.errors.length > 0 || loaded.extensions.length !== 1) {
    throw new Error(`Pi public loader failed: ${loaded.errors.map((error) => error.error).join("; ")}`);
  }
  const handlers = [...loaded.extensions[0].handlers.keys()].sort();
  const missing = PI_0844_REQUIRED_HOOKS.filter((hook) => !handlers.includes(hook));
  const capabilities = {
    context: handlers.includes("context"),
    toolResult: handlers.includes("tool_result"),
    compaction: ["session_before_compact", "session_compact", "session_compact_failed"].every((hook) =>
      handlers.includes(hook),
    ),
    lifecycle: [
      "agent_settled",
      "input",
      "input_result",
      "message_end",
      "model_select",
      "session_shutdown",
      "session_start",
      "session_tree",
    ].every((hook) => handlers.includes(hook)),
  };
  return { version: VERSION, ready: missing.length === 0 && Object.values(capabilities).every(Boolean), handlers, missing, capabilities };
}

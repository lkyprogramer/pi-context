export const REQUIRED_PI_CAPABILITIES = [
  "context",
  "tool_result",
  "tool_call",
  "input",
  "message_end",
  "session_before_compact",
  "session_compact",
  "session_start",
  "session_tree",
  "session_shutdown",
  "agent_settled",
  "appendEntry",
] as const;

export type PiCapability = (typeof REQUIRED_PI_CAPABILITIES)[number];

export interface PiCapabilityProbeResult {
  readonly ready: boolean;
  readonly missing: readonly PiCapability[];
}

export function probePiCapabilities(available: ReadonlySet<string>): PiCapabilityProbeResult {
  const missing = REQUIRED_PI_CAPABILITIES.filter((name) => !available.has(name));
  return Object.freeze({ ready: missing.length === 0, missing });
}

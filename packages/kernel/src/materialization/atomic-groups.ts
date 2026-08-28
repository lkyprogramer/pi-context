import type { HostMessage } from "../../../contracts/src/index.js";

export interface PairingResult {
  ok: boolean;
  reason?: "orphan-result" | "missing-result" | "duplicate-result";
  callIds?: string[];
}

export const OVERSIZE_TOOL_RESULT_CHARS = 8000;

export function toolCallIds(message: HostMessage): string[] {
  return message.content.flatMap((block) => (block.type === "tool-call-ref" ? [block.ref] : []));
}

export function resultTextSize(message: HostMessage): number {
  return message.content.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0);
}

export function validateToolPairs(messages: readonly HostMessage[]): PairingResult {
  const opened = new Set<string>();
  const closed = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const id of toolCallIds(message)) opened.add(id);
    }
    if (message.role === "tool-result") {
      const id = message.toolCallId;
      if (!id || !opened.has(id)) return { ok: false, reason: "orphan-result", callIds: id ? [id] : [] };
      if (closed.has(id)) return { ok: false, reason: "duplicate-result", callIds: [id] };
      closed.add(id);
    }
  }
  return { ok: true };
}

export function requestPointerization(message: HostMessage): { kind: "pointerize"; hostMessageId: string; bytes: number } | null {
  if (message.role !== "tool-result") return null;
  const bytes = resultTextSize(message);
  if (bytes <= OVERSIZE_TOOL_RESULT_CHARS) return null;
  return { kind: "pointerize", hostMessageId: message.hostMessageId, bytes };
}

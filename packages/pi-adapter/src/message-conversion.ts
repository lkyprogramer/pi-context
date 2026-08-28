import type { HostMessage, SourceClass } from "../../contracts/src/index.js";

export interface PiAgentMessage {
  role: string;
  content: unknown;
  timestamp?: number;
  toolCallId?: string;
}

export function toHostMessages(messages: readonly PiAgentMessage[]): HostMessage[] {
  return messages.map((message, index) => {
    const role = normalizeRole(message.role);
    return {
      hostMessageId: `pi_${index}`,
      role,
      timestamp: message.timestamp ?? index,
      content: toBlocks(message.content),
      sourceClass: sourceClassFor(role, message.role),
      toolCallId: message.toolCallId,
    };
  });
}

export function toPiMessages(messages: readonly HostMessage[]): PiAgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((block) => (block.type === "text" ? block.text : block)).join(""),
    timestamp: message.timestamp,
    toolCallId: message.toolCallId,
  }));
}

function normalizeRole(role: string): HostMessage["role"] {
  if (role === "user" || role === "assistant" || role === "tool-result" || role === "custom") return role;
  if (role === "compaction" || role === "branch-summary" || role === "system") return "custom";
  return "custom";
}

function sourceClassFor(role: HostMessage["role"], rawRole: string): SourceClass {
  if (role === "user") return "authenticated-user";
  if (role === "tool-result") return "trusted-tool";
  if (rawRole === "compaction" || rawRole === "branch-summary" || role === "custom") return "agent-derived";
  return "agent-derived";
}

function toBlocks(content: unknown): HostMessage["content"] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return { type: "text" as const, text: item };
      if (item && typeof item === "object" && "type" in item) return item as HostMessage["content"][number];
      return { type: "text" as const, text: JSON.stringify(item) };
    });
  }
  return [{ type: "text", text: content == null ? "" : String(content) }];
}

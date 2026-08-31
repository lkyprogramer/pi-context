import { domainHash, type HostMessage, type SourceClass } from "../../contracts/src/index.js";

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface PiAgentMessage {
  role: string;
  content?: unknown;
  timestamp?: number;
  toolCallId?: string;
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string;
  summary?: string;
  tokensBefore?: number;
}

export function toHostMessages(messages: readonly PiAgentMessage[]): HostMessage[] {
  return messages.map((message) => {
    const role = normalizeRole(message.role);
    return {
      hostMessageId: `pi_${domainHash("pi-host", {
        role,
        toolCallId: message.toolCallId ?? null,
        timestamp: message.timestamp ?? null,
        content: message.content ?? null,
      }).slice(0, 16)}`,
      role,
      timestamp: message.timestamp ?? 0,
      content: toBlocks(message.content),
      sourceClass: sourceClassFor(role, message.role),
      toolCallId: message.toolCallId,
    };
  });
}

export function emptyPiUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function toPiMessages(messages: readonly HostMessage[]): PiAgentMessage[] {
  return messages.map((message) => {
    const role = message.role === "tool-result" ? "toolResult" : message.role;
    const converted: PiAgentMessage = {
      role,
      content: toPiContent(message.role, message.content),
      timestamp: message.timestamp,
      toolCallId: message.toolCallId,
    };
    if (role === "assistant") converted.usage = emptyPiUsage();
    return converted;
  });
}

function toPiContent(role: HostMessage["role"], content: HostMessage["content"]): unknown {
  const texts = content
    .map((block) => {
      if (block.type === "text") return block.text;
      if ("ref" in block && typeof block.ref === "string") return `${block.type}:${block.ref}`;
      return "";
    })
    .filter((text) => text.length > 0);
  if (role === "assistant") {
    if (content.some((block) => {
      const type = "type" in block ? String(block.type) : "";
      return type === "thinking" || type === "toolCall";
    })) {
      return content;
    }
    return (texts.length > 0 ? texts : [""]).map((text) => ({ type: "text", text }));
  }
  return texts.join("");
}

function normalizeRole(role: string): HostMessage["role"] {
  if (role === "user" || role === "assistant" || role === "tool-result" || role === "custom") return role;
  if (role === "toolResult") return "tool-result";
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

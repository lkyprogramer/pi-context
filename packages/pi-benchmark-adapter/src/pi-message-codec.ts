export type SessionEntryType = "message" | "compaction" | "custom" | "session";

export interface DecodedSessionEntry {
  readonly type: SessionEntryType;
  readonly id: string;
  readonly parentId: string | null;
  readonly role?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly timestamp?: number;
  readonly contentText: string;
  readonly raw: unknown;
}

export function decodeSessionJsonl(text: string): DecodedSessionEntry[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => decodeSessionEntry(JSON.parse(line)));
}

export function decodeSessionEntry(entry: unknown): DecodedSessionEntry {
  if (entry === null || typeof entry !== "object") {
    throw new Error("session entry must be an object");
  }
  const record = entry as Record<string, unknown>;
  const type = typeof record.type === "string" ? (record.type as SessionEntryType) : "message";
  const id = typeof record.id === "string" ? record.id : "";
  const parentId = record.parentId === null || record.parentId === undefined ? null : String(record.parentId);
  const message = record.message !== null && typeof record.message === "object" ? (record.message as Record<string, unknown>) : {};
  return {
    type,
    id,
    parentId,
    role: typeof message.role === "string" ? message.role : typeof record.role === "string" ? record.role : type,
    toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
    toolName: typeof message.toolName === "string" ? message.toolName : undefined,
    timestamp: typeof message.timestamp === "number" ? message.timestamp : typeof record.timestamp === "number" ? record.timestamp : undefined,
    contentText: extractText(message.content ?? record.content ?? record.summary),
    raw: entry,
  };
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part !== null && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
}

export function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

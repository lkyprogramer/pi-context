import { hashCanonical, sha256Hex, utf8Bytes } from "../contracts.js";
import type { RequestIdentity } from "./view-contracts.js";

export type { RequestIdentity };

const SUCCESS = new Set(["stop", "toolUse"]);
const REJECT = new Set(["error", "aborted", "length"]);

function identityKey(id: RequestIdentity): string {
  return [
    id.workspaceId,
    id.sessionId,
    id.provider,
    id.model,
    id.configHash,
    id.compactionBoundary ?? "",
    String(id.epoch),
  ].join("|");
}

function sameIdentity(a: RequestIdentity, b: RequestIdentity): boolean {
  return identityKey(a) === identityKey(b);
}

function confirmKey(id: RequestIdentity, fieldKey: string): string {
  return `${identityKey(id)}#${fieldKey}`;
}

export function isSuccessfulAssistantStop(stopReason: string): boolean {
  return SUCCESS.has(stopReason) && !REJECT.has(stopReason);
}

type Pending = {
  identity: RequestIdentity;
  fieldHashes: Map<string, string>;
  viewHash: string;
  sent: boolean;
  sentKeys: string[];
  method: "provider-payload" | "unavailable";
  accepted: boolean;
};

export class RequestWitnessTracker {
  private epoch = 0;
  private seq = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly confirmed = new Map<string, string>();

  currentEpoch(): number {
    return this.epoch;
  }

  prepare(identity: RequestIdentity, fieldHashes: ReadonlyMap<string, string>, viewHash: string): string {
    for (const [id, pending] of this.pending) {
      if (
        !pending.accepted &&
        pending.identity.sessionId === identity.sessionId &&
        pending.identity.workspaceId === identity.workspaceId
      ) {
        this.pending.delete(id);
      }
    }
    const requestId = `w-${++this.seq}`;
    this.pending.set(requestId, {
      identity: { ...identity },
      fieldHashes: new Map(fieldHashes),
      viewHash,
      sent: false,
      sentKeys: [],
      method: "unavailable",
      accepted: false,
    });
    return requestId;
  }

  markSent(requestId: string, identity: RequestIdentity, keys: string[]): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.accepted || !sameIdentity(pending.identity, identity)) return false;
    const concurrent = [...this.pending.values()].some(
      (other) =>
        other !== pending &&
        other.sent &&
        !other.accepted &&
        other.identity.sessionId === identity.sessionId &&
        other.identity.workspaceId === identity.workspaceId,
    );
    if (concurrent) {
      pending.method = "unavailable";
      return false;
    }
    pending.sent = true;
    pending.sentKeys = keys.filter((key) => pending.fieldHashes.has(key));
    pending.method = "provider-payload";
    return true;
  }

  markUnavailable(requestId: string, identity: RequestIdentity): void {
    const pending = this.pending.get(requestId);
    if (!pending || !sameIdentity(pending.identity, identity)) return;
    pending.method = "unavailable";
  }

  accept(requestId: string, identity: RequestIdentity, stopReason: string, responseId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.accepted || !sameIdentity(pending.identity, identity)) return false;
    if (!pending.sent || pending.method !== "provider-payload") return false;
    if (!isSuccessfulAssistantStop(stopReason)) return false;
    if (typeof responseId !== "string" || responseId.length === 0) return false;
    pending.accepted = true;
    for (const key of pending.sentKeys) {
      const hash = pending.fieldHashes.get(key);
      if (hash) this.confirmed.set(confirmKey(identity, key), hash);
    }
    return true;
  }

  has(identity: RequestIdentity, key: string, hash: string): boolean {
    return this.confirmed.get(confirmKey(identity, key)) === hash;
  }

  reset(): void {
    this.epoch += 1;
    this.pending.clear();
    this.confirmed.clear();
  }
}

export function inspectOpenAICompletionsPayload(
  payload: unknown,
): { method: "provider-payload"; tools: { callId: string; contentHash: string }[] } | { method: "unavailable" } {
  const messages = payloadMessages(payload);
  if (!messages) return { method: "unavailable" };
  const tools: { callId: string; contentHash: string }[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const rec = msg as { role?: unknown; content?: unknown; tool_call_id?: unknown; toolCallId?: unknown };
    const role = rec.role;
    if (role !== "tool" && role !== "toolResult") continue;
    const callId =
      typeof rec.tool_call_id === "string"
        ? rec.tool_call_id
        : typeof rec.toolCallId === "string"
          ? rec.toolCallId
          : toolCallIdFromContent(rec.content);
    const text = payloadText(rec.content);
    if (!callId || !text) return { method: "unavailable" };
    tools.push({ callId, contentHash: sha256Hex(utf8Bytes(text)) });
  }
  return { method: "provider-payload", tools };
}

export function keysMatchingPayload(
  fieldHashes: ReadonlyMap<string, string>,
  tools: readonly { callId: string; contentHash: string }[],
  callIds?: ReadonlyMap<string, string>,
): string[] {
  const keys: string[] = [];
  for (const [key, hash] of fieldHashes) {
    const callId = callIds?.get(key);
    const hits = tools.filter((tool) => tool.contentHash === hash && (callId == null || tool.callId === callId));
    if (hits.length === 1) keys.push(key);
  }
  return keys;
}

export function viewHashOf(fields: readonly { key: string; sourceHash: string }[]): string {
  return hashCanonical(fields.map((field) => ({ k: field.key, h: field.sourceHash })));
}

function payloadMessages(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as { messages?: unknown };
  return Array.isArray(rec.messages) ? rec.messages : null;
}

function toolCallIdFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block && typeof block === "object" && typeof (block as { toolCallId?: unknown }).toolCallId === "string") {
      return (block as { toolCallId: string }).toolCallId;
    }
  }
  return "";
}

function payloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

import { sha256Hex, utf8Bytes, type FoldPlan } from "../contracts.js";

export interface AgentMessage {
  role: string;
  content: unknown;
  toolCallId?: unknown;
  [key: string]: unknown;
}

export function renderFold(
  messages: AgentMessage[],
  plan: FoldPlan,
  mapping: ReadonlyMap<number, { entryId: string }>,
): { messages: AgentMessage[]; applied: number; firstChangedIndex: number | null } {
  let applied = 0;
  let firstChangedIndex: number | null = null;
  messages.forEach((msg, idx) => {
    if (msg.role !== "toolResult") return;
    const id = mapping.get(idx)?.entryId;
    if (!id || !Array.isArray(msg.content)) return;
    msg.content.forEach((block, i) => {
      if (!block || typeof block !== "object") return;
      const rec = block as { type?: string; text?: string };
      const replacement = plan.replacements.get(`${id}:${i}`);
      if (!replacement || rec.type !== "text" || typeof rec.text !== "string") return;
      if (sha256Hex(utf8Bytes(rec.text)) !== replacement.sourceHash) return;
      rec.text = replacement.stub;
      applied += 1;
      if (firstChangedIndex == null) firstChangedIndex = idx;
    });
  });
  return { messages, applied, firstChangedIndex };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

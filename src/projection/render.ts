import type { ContentBlock } from "../contracts.js";
import type { FrozenPlan } from "./planner.js";
import { decideBudget, estimateText } from "./budget.js";

export interface AgentMessage {
  role: string;
  content: ContentBlock[] | string;
  [key: string]: unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isProtected(block: ContentBlock): boolean {
  return block.type === "image" || (block.type !== "text" && block.type !== "toolResult");
}

export function cloneMessages<T>(value: T): T {
  return clone(value);
}

export function renderMessages(input: {
  messages: AgentMessage[];
  plan: FrozenPlan | null;
  profile: "off" | "observe" | "balanced" | "experimental-semantic";
  optionalBudget: number;
  mappedEntries?: Map<number, { id: string }>;
  generation?: number;
}): { messages: AgentMessage[]; bypassed: boolean } {
  const original = input.messages;
  if (input.profile === "off" || input.profile === "observe" || !input.plan || input.plan.replacements.length === 0) {
    return { messages: original, bypassed: false };
  }
  if (typeof input.generation === "number" && input.plan.snapshot.generation !== input.generation) {
    return { messages: original, bypassed: false };
  }
  const byId = new Map(input.plan.replacements.map((r) => [r.entryId, r]));
  let optional = 0;
  const next = clone(original);
  next.forEach((msg, index) => {
    const entryId = input.mappedEntries?.get(index)?.id;
    const replacement = entryId ? byId.get(entryId) : undefined;
    if (!replacement) return;
    if (Array.isArray(msg.content)) {
      if (msg.content.some((block) => block.type === "image") || msg.content.some(isProtected) && msg.content.some((block) => block.type === "image")) {
        return;
      }
      for (const block of msg.content) {
        if (block.type !== "text" && block.type !== "toolResult") continue;
        if (typeof block.text !== "string") continue;
        optional += estimateText(replacement.replacementText).value;
        block.text = replacement.replacementText;
      }
      return;
    }
    if (typeof msg.content === "string") {
      optional += estimateText(replacement.replacementText).value;
      msg.content = replacement.replacementText;
    }
  });
  const decision = decideBudget({
    protectedTokens: estimateText(JSON.stringify(original)).value,
    optionalTokens: optional,
    limit: Math.max(input.optionalBudget, estimateText(JSON.stringify(original)).value),
    unknownImageCost: original.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image")),
  });
  if (decision.kind === "bypass") return { messages: original, bypassed: true };
  return { messages: next, bypassed: false };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

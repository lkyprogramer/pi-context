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

export function renderMessages(input: {
  messages: AgentMessage[];
  plan: FrozenPlan | null;
  profile: "off" | "observe" | "balanced" | "experimental-semantic";
  optionalBudget: number;
}): { messages: AgentMessage[]; bypassed: boolean } {
  const original = input.messages;
  if (input.profile === "off" || input.profile === "observe" || !input.plan) {
    return { messages: original, bypassed: false };
  }
  const byId = new Map(input.plan.replacements.map((r) => [r.entryId, r]));
  let optional = 0;
  const next = clone(original);
  for (const msg of next) {
    if (!Array.isArray(msg.content)) continue;
    if (msg.content.some(isProtected) && msg.content.some((b) => b.type === "image")) {
      continue;
    }
    for (const block of msg.content) {
      if (block.type !== "text" && block.type !== "toolResult") continue;
      const key = typeof block.entryId === "string" ? block.entryId : undefined;
      const replacement = key ? byId.get(key) : undefined;
      if (!replacement) continue;
      optional += estimateText(replacement.replacementText).value;
      if (typeof block.text === "string") block.text = replacement.replacementText;
    }
  }
  const decision = decideBudget({
    protectedTokens: estimateText(JSON.stringify(original)).value,
    optionalTokens: optional,
    limit: Math.max(input.optionalBudget, estimateText(JSON.stringify(original)).value),
    unknownImageCost: original.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image")),
  });
  if (decision.kind === "bypass") return { messages: original, bypassed: true };
  Object.freeze(original);
  return { messages: next, bypassed: false };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

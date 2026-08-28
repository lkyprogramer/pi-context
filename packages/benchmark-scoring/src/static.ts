import type { CompressionArtifact, Oracle, RawTrace } from "../../benchmark-contracts/src/index.js";
import { hasInvertedPolarity } from "./matchers.js";

export interface TokenCounter {
  count(text: string): number;
}

export function charTokenCounter(): TokenCounter {
  return { count: (text) => Math.max(1, Math.ceil(text.length / 4)) };
}

export interface ItemMatchRecord {
  readonly itemId: string;
  readonly ok: boolean;
  readonly failureCode?: string;
}

export interface StaticScore {
  readonly polarityAccuracy: number;
  readonly toolPairViolations: number;
  readonly mustOmitLeaks: number;
  readonly coverage: number;
}

export interface StaticScoreResult {
  readonly score: StaticScore;
  readonly matches: readonly ItemMatchRecord[];
}

export interface StaticScoringInput {
  artifact: CompressionArtifact;
  trace: RawTrace;
  oracle: Oracle;
  tokenizer: TokenCounter;
}

function artifactText(artifact: CompressionArtifact): string {
  return JSON.stringify(artifact.messages);
}

export function scoreStaticArtifact(input: StaticScoringInput): StaticScoreResult {
  const text = artifactText(input.artifact);
  const matches: ItemMatchRecord[] = input.oracle.items.map((item) => {
    const canonical = String(item.canonical);
    if (hasInvertedPolarity(canonical, text)) {
      return { itemId: item.id, ok: false, failureCode: "POLARITY_MISMATCH" };
    }
    if (item.visibility === "must-omit" && text.includes(canonical)) {
      return { itemId: item.id, ok: false, failureCode: "MUST_OMIT_LEAK" };
    }
    if (item.visibility === "must-visible" && !text.toLowerCase().includes(canonical.toLowerCase().slice(0, 12))) {
      return { itemId: item.id, ok: false, failureCode: "MISSING_VISIBLE" };
    }
    return { itemId: item.id, ok: true };
  });
  const toolMessages = input.artifact.messages.filter((message): message is { role: string; toolCallId?: string } => {
    return message !== null && typeof message === "object" && "role" in message;
  });
  const toolPairViolations = toolMessages.filter((message) => message.role === "toolResult" && message.toolCallId === "missing").length;
  const polarityMismatches = matches.filter((match) => match.failureCode === "POLARITY_MISMATCH").length;
  return {
    score: {
      polarityAccuracy: matches.length === 0 ? 1 : 1 - polarityMismatches / matches.length,
      toolPairViolations,
      mustOmitLeaks: matches.filter((match) => match.failureCode === "MUST_OMIT_LEAK").length,
      coverage: matches.filter((match) => match.ok).length / Math.max(matches.length, 1),
    },
    matches,
  };
}

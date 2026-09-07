import type { Profile } from "../contracts.js";

export function shouldGenerateSemantic(profile: Profile, enabled: boolean): boolean {
  return profile === "experimental-semantic" && enabled;
}

export function evaluateSemanticCandidate(input: {
  originalTokens: number;
  candidateTokens: number;
  hasToolCall: boolean;
  fakeSource: boolean;
  timeout: boolean;
  cancelled: boolean;
}): { stage: boolean; reason: string } {
  if (input.hasToolCall) return { stage: false, reason: "toolCall" };
  if (input.fakeSource) return { stage: false, reason: "fake-source" };
  if (input.timeout) return { stage: false, reason: "timeout" };
  if (input.cancelled) return { stage: false, reason: "cancelled" };
  if (!(input.candidateTokens < input.originalTokens)) return { stage: false, reason: "not-shortened" };
  return { stage: true, reason: "ok" };
}

export function semanticPromptParts(input: {
  messagesToSummarize: string;
  turnPrefix: string;
  previousSummary: string;
  firstKept: string;
}): { messagesToSummarize: string; turnPrefix: string; previousSummary: string; firstKept: string } {
  return {
    messagesToSummarize: input.messagesToSummarize,
    turnPrefix: input.turnPrefix,
    previousSummary: input.previousSummary,
    firstKept: input.firstKept,
  };
}

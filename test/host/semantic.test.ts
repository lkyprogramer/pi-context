import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { evaluateSemanticCandidate, semanticPromptParts, shouldGenerateSemantic } from "../../src/checkpoint/semantic.js";
import { b3ShorterIsNotWin, recommendB3 } from "../../eval/semantic-arm.js";

describe("T18 semantic", () => {
  it("stays off unless experimental-semantic and enabled", () => {
    expect(shouldGenerateSemantic("observe", true)).toBe(false);
    expect(shouldGenerateSemantic("balanced", true)).toBe(false);
    expect(shouldGenerateSemantic("experimental-semantic", false)).toBe(false);
    expect(shouldGenerateSemantic("experimental-semantic", true)).toBe(true);
    expect(DEFAULT_CONFIG.semantic.enabled).toBe(false);
  });

  it("does not stage toolCall, fake source, timeout, cancel, or non-shortening", () => {
    expect(evaluateSemanticCandidate({ originalTokens: 100, candidateTokens: 10, hasToolCall: true, fakeSource: false, timeout: false, cancelled: false }).stage).toBe(false);
    expect(evaluateSemanticCandidate({ originalTokens: 100, candidateTokens: 10, hasToolCall: false, fakeSource: true, timeout: false, cancelled: false }).stage).toBe(false);
    expect(evaluateSemanticCandidate({ originalTokens: 100, candidateTokens: 10, hasToolCall: false, fakeSource: false, timeout: true, cancelled: false }).stage).toBe(false);
    expect(evaluateSemanticCandidate({ originalTokens: 100, candidateTokens: 100, hasToolCall: false, fakeSource: false, timeout: false, cancelled: false }).stage).toBe(false);
    expect(evaluateSemanticCandidate({ originalTokens: 100, candidateTokens: 40, hasToolCall: false, fakeSource: false, timeout: false, cancelled: false }).stage).toBe(true);
    const parts = semanticPromptParts({ messagesToSummarize: "m", turnPrefix: "t", previousSummary: "p", firstKept: "k" });
    expect(parts.firstKept).toBe("k");
    expect(b3ShorterIsNotWin(true)).toBe(true);
    expect(recommendB3({ netGain: false })).toBe("do-not-default");
  });
});

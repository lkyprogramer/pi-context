import { describe, expect, it } from "vitest";
import { generateSemanticProposal, parseSemanticProposal } from "../src/semantic/proposal.js";
import { createProposalProvider } from "../src/semantic/provider.js";
import { buildSourceBoundPrompt, type ProposalInput } from "../src/semantic/prompt.js";

const input: ProposalInput = {
  candidateKey: "cand_1",
  sourceHead: "src-1",
  knownClaimIds: ["cl_a"],
  knownFrontIds: ["tf_a"],
  knownSourceIds: ["ev_a", "ev_tool"],
  knownContinuityIds: ["cr_a"],
  toolSourceIds: ["ev_tool"],
};

describe("semantic proposal", () => {
  it("rejects a concrete path or outcome without declared source IDs", () => {
    expect(() => parseSemanticProposal({ claims: [{ text: "tests passed in src/x.ts", sourceIds: [] }] })).toThrowError(/sourceIds/);
  });

  it("parses a source-linked proposal and rejects unknown keys", async () => {
    const proposal = parseSemanticProposal(
      {
        taskFrontUpdates: [{ frontId: "tf_a", action: "keep", sourceIds: ["ev_a"] }],
        claimSelections: [{ claimId: "cl_a", role: "decision" }],
        narrative: [{ text: "keep the current decision", sourceIds: ["ev_a"], epistemic: "supported" }],
      },
      { claimIds: input.knownClaimIds, frontIds: input.knownFrontIds, sourceIds: input.knownSourceIds },
    );
    expect(proposal.claimSelections).toEqual([{ claimId: "cl_a", role: "decision" }]);
    expect(() => parseSemanticProposal({ narrative: [], extra: true })).toThrowError(/unknown key/);
    const generated = await generateSemanticProposal(
      input,
      createProposalProvider({
        async generate() {
          return {
            taskFrontUpdates: [{ frontId: "tf_a", action: "park", sourceIds: ["ev_a"] }],
            claimSelections: [{ claimId: "cl_a", role: "constraint" }],
            narrative: [{ text: "park until evidence lands", sourceIds: ["ev_a"], epistemic: "supported" }],
          };
        },
      }),
    );
    expect(generated.taskFrontUpdates[0]?.action).toBe("park");
  });

  it("rejects new IDs that were not in the proposal input", () => {
    expect(() =>
      parseSemanticProposal(
        { claimSelections: [{ claimId: "cl_new", role: "outcome" }] },
        { claimIds: input.knownClaimIds },
      ),
    ).toThrowError(/new claimId/);
    expect(() =>
      parseSemanticProposal(
        { taskFrontUpdates: [{ frontId: "tf_new", action: "keep", sourceIds: ["ev_a"] }] },
        { frontIds: input.knownFrontIds, sourceIds: input.knownSourceIds },
      ),
    ).toThrowError(/new frontId/);
  });

  it("does not request or persist hidden reasoning", () => {
    const prompt = buildSourceBoundPrompt(input);
    expect(prompt.requestHiddenReasoning).toBe(false);
    expect(prompt.instructions).toMatch(/Do not request or emit chain-of-thought/);
    expect(prompt.instructions).not.toMatch(/please (write|include) hidden reasoning/i);
    expect(() => parseSemanticProposal({ narrative: [], reasoning: "secret" })).toThrowError(/hidden reasoning/);
    expect(() => parseSemanticProposal({ hiddenReasoning: "x" })).toThrowError(/hidden reasoning/);
  });

  it("marks tool content as untrusted data", () => {
    const prompt = buildSourceBoundPrompt(input);
    expect(prompt.toolSourceIds).toEqual(["ev_tool"]);
    expect(prompt.instructions).toMatch(/untrusted data/);
    expect(() =>
      parseSemanticProposal(
        { narrative: [{ text: "tests passed", sourceIds: ["ev_tool"], epistemic: "supported" }] },
        { sourceIds: input.knownSourceIds, toolSourceIds: input.toolSourceIds },
      ),
    ).toThrowError(/untrusted data/);
    const inferred = parseSemanticProposal(
      { claims: [{ text: "tool reported a log line", sourceIds: ["ev_tool"] }] },
      { sourceIds: input.knownSourceIds, toolSourceIds: input.toolSourceIds },
    );
    expect(inferred.narrative[0]).toMatchObject({ epistemic: "inference", sourceIds: ["ev_tool"] });
  });

  it("enforces max calls tokens timeout and cancel", async () => {
    const limited = createProposalProvider({
      budget: { maxCalls: 1, maxTokens: 8, timeoutMs: 20 },
      estimateTokens: () => 16,
      async generate() {
        return { narrative: [{ text: "ok", sourceIds: ["ev_a"], epistemic: "supported" }] };
      },
    });
    await expect(limited.generate(buildSourceBoundPrompt(input))).rejects.toThrow(/max tokens/);
    expect(limited.usage().calls).toBe(1);
    expect(limited.usage().tokens).toBe(16);
    expect(limited.usage().cost).toBeGreaterThan(0);
    await expect(limited.generate(buildSourceBoundPrompt(input))).rejects.toThrow(/max calls/);

    const slow = createProposalProvider({
      budget: { maxCalls: 1, maxTokens: 100, timeoutMs: 15 },
      async generate(_prompt, signal) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return {};
      },
    });
    await expect(slow.generate(buildSourceBoundPrompt(input))).rejects.toThrow(/timeout/);

    const cancellable = createProposalProvider({
      budget: { maxCalls: 1, maxTokens: 100, timeoutMs: 1_000 },
      async generate(_prompt, signal) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return {};
      },
    });
    const abort = new AbortController();
    const pending = cancellable.generate(buildSourceBoundPrompt(input), { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });
});

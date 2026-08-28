import type { SourceBoundPrompt } from "./prompt.js";

export interface ProposalBudget {
  maxCalls: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface ProposalUsage {
  calls: number;
  tokens: number;
  cost: number;
}

export interface ProposalProvider {
  purpose: "semantic-proposal";
  budget: ProposalBudget;
  generate(prompt: SourceBoundPrompt, opts?: { signal?: AbortSignal }): Promise<unknown>;
  usage(): ProposalUsage;
}

export function createProposalProvider(impl: {
  generate: (prompt: SourceBoundPrompt, signal: AbortSignal) => Promise<unknown>;
  budget?: Partial<ProposalBudget>;
  estimateTokens?: (prompt: SourceBoundPrompt, raw: unknown) => number;
  tokenCost?: number;
}): ProposalProvider {
  const budget: ProposalBudget = {
    maxCalls: 1,
    maxTokens: 2_000,
    timeoutMs: 5_000,
    ...impl.budget,
  };
  const usage: ProposalUsage = { calls: 0, tokens: 0, cost: 0 };
  const estimate =
    impl.estimateTokens ??
    ((prompt, raw) => prompt.sourceIds.length + JSON.stringify(raw ?? "").length);
  return {
    purpose: "semantic-proposal",
    budget,
    usage: () => ({ ...usage }),
    async generate(prompt, opts) {
      if (prompt.requestHiddenReasoning !== false) {
        throw new Error("hidden reasoning was requested");
      }
      if (usage.calls >= budget.maxCalls) {
        throw new Error("max calls exceeded");
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), budget.timeoutMs);
      usage.calls += 1;
      try {
        const raw = await impl.generate(prompt, controller.signal);
        if (controller.signal.aborted) throw new Error("cancelled");
        const tokens = estimate(prompt, raw);
        usage.tokens += tokens;
        usage.cost += tokens * (impl.tokenCost ?? 1);
        if (usage.tokens > budget.maxTokens) throw new Error("max tokens exceeded");
        return raw;
      } catch (error) {
        if (controller.signal.aborted) {
          throw opts?.signal?.aborted ? new Error("cancelled") : new Error("timeout");
        }
        throw error;
      } finally {
        clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

import type { ContextBudget, RecordedOrLiveProvider } from "../../src/pi-native.js";
import type { RawTrace } from "../../../benchmark-contracts/src/index.js";

export function recordedProvider(name = "pi-native-summary.jsonl"): RecordedOrLiveProvider {
  return {
    kind: "recorded",
    name,
    async compact(trace: RawTrace, budget: ContextBudget) {
      const kept = trace.entries.slice(-Math.max(1, Math.min(trace.entries.length, 4)));
      return {
        summary: `pi-native compact ${trace.traceId}`,
        visibleTokens: Math.min(budget.targetVisibleTokens, kept.length * 32),
        messages: kept.map((entry) => ({ role: entry.role, entryId: entry.entryId })),
      };
    },
  };
}

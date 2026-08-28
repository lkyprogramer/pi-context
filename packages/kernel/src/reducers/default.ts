import type { CapturedObservation, ObservationReducer, ReducerLimits, ReducerOutput } from "./types.js";

export const defaultPointerReducer: ObservationReducer = {
  id: "default-pointer",
  revision: "1",
  matches() {
    return true;
  },
  async reduce(input: CapturedObservation, _limits: ReducerLimits): Promise<ReducerOutput> {
    const pointer = input.rawBlobId ? `ctx://observation/${input.rawBlobId}` : "ctx://observation/unavailable";
    return {
      visibleText: `[pcr observation pointer] ${pointer}`,
      facts: [],
      artifacts: input.rawBlobId ? [{ rawBlobId: input.rawBlobId }] : [],
      fallback: true,
    };
  },
};

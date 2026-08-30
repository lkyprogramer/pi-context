import { rawPointer } from "./text.js";
import type { Reducer, ReducerInput } from "./types.js";

export const pointerReducer: Reducer = {
  id: "default-pointer",
  supports: () => true,
  async reduce(input: ReducerInput) {
    return {
      visibleText: `[pcr observation pointer] ${rawPointer(input.rawBlobId)}`,
      facts: [],
      artifacts: input.rawBlobId ? [{ rawBlobId: input.rawBlobId }] : [],
      fallback: true,
    };
  },
};

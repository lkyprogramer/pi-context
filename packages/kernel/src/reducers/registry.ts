import { domainHash } from "../../../contracts/src/index.js";
import { defaultPointerReducer } from "./default.js";
import { DEFAULT_LIMITS, type CapturedObservation, type ObservationReducer, type ReducedObservation } from "./types.js";

export class ReducerRegistry {
  private readonly reducers: ObservationReducer[] = [];

  register(reducer: ObservationReducer): void {
    if (this.reducers.some((item) => item.id === reducer.id)) {
      throw new Error(`duplicate reducer:${reducer.id}`);
    }
    this.reducers.push(reducer);
  }

  fingerprint(): string {
    return domainHash(
      "reducer-registry",
      this.reducers.map((item) => ({ id: item.id, revision: item.revision })),
    );
  }

  async reduce(input: CapturedObservation): Promise<ReducedObservation> {
    const reducer = this.reducers.find((item) => item.matches(input)) ?? defaultPointerReducer;
    const limits = DEFAULT_LIMITS;
    let output;
    try {
      if ((input.bytes ?? 0) > limits.maxBytes) {
        output = await defaultPointerReducer.reduce(input, limits);
        output = { ...output, fallback: true };
      } else {
        output = await Promise.race([
          reducer.reduce(input, limits),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("PCR_REDUCER_TIMEOUT")), limits.maxMs);
          }),
        ]);
      }
    } catch {
      output = { ...(await defaultPointerReducer.reduce(input, limits)), fallback: true };
    }
    return {
      ...output,
      reducer: { id: reducer.id, revision: reducer.revision },
      rawBlobId: input.rawBlobId,
      sourceContentHash: input.sourceContentHash,
      sourceClass: input.sourceClass,
    };
  }
}

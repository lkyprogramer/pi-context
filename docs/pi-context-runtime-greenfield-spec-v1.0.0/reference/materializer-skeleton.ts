import type { MaterializationInput, MaterializedView } from "./contracts.js";

export async function materialize(input: MaterializationInput, signal: AbortSignal): Promise<MaterializedView> {
  signal.throwIfAborted();
  const activeTurn = selectExactActiveTurn(input.canonicalMessages);
  const directives = await loadActiveDirectives(input.cursor, signal);
  const continuity = await loadCommittedContinuity(input.cursor, signal);
  const historicalTail = selectHistoricalAtomicTail(input.canonicalMessages, activeTurn.startIndex);
  const augmentation = await loadBoundedAugmentation(input.cursor, signal);
  return allocateAndRender({ input, activeTurn, directives, continuity, historicalTail, augmentation });
}

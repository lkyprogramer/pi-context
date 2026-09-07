import type { Pin } from "./pins.js";
import type { Scope } from "../contracts.js";
import { authorize } from "../history/scope.js";
import { quoteHash } from "./pins.js";

export function validatePin(pin: Pin, scope: Scope, currentText: string | undefined): { ok: boolean; reason?: string } {
  if (!authorize(scope, pin.source.entryId)) return { ok: false, reason: "not visible" };
  if (currentText === undefined) return { ok: false, reason: "source-missing" };
  try {
    if (quoteHash(currentText, pin.startByte, pin.endByteExclusive) !== pin.quoteHash) {
      return { ok: false, reason: "source-changed" };
    }
  } catch {
    return { ok: false, reason: "invalid-range" };
  }
  return { ok: true };
}

export function passingTestDoesNotClearFailure(earlierFailed: boolean, laterPassedDifferentCommand: boolean): boolean {
  return earlierFailed && laterPassedDifferentCommand;
}

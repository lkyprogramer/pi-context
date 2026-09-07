import type { SnapshotKey, SourceRef } from "../contracts.js";

export interface ExposureAttempt {
  attemptId: string;
  snapshot: SnapshotKey;
  includedOriginalRefs: readonly SourceRef[];
  startedAtMs: number;
}

export class ExposureLedger {
  private inflight = new Map<string, ExposureAttempt>();
  private exposed = new Map<string, number>();

  begin(attempt: ExposureAttempt): void {
    this.inflight.set(attempt.attemptId, attempt);
  }

  confirm(attemptId: string, snapshot: SnapshotKey, outcome: "stop" | "toolUse"): void {
    const attempt = this.inflight.get(attemptId);
    this.inflight.delete(attemptId);
    if (!attempt) return;
    if (attempt.snapshot.generation !== snapshot.generation) return;
    if (outcome !== "stop" && outcome !== "toolUse") return;
    for (const ref of attempt.includedOriginalRefs) {
      this.exposed.set(ref, snapshot.generation);
    }
  }

  fail(attemptId: string): void {
    this.inflight.delete(attemptId);
  }

  isExposed(ref: SourceRef, generation: number): boolean {
    const g = this.exposed.get(ref);
    return g !== undefined && g <= generation;
  }

  invalidate(generation: number): void {
    for (const [ref, g] of this.exposed) {
      if (g < generation) this.exposed.delete(ref);
    }
    this.inflight.clear();
  }
}

export function outcomeFromStop(stopReason?: string, errorMessage?: string, streamOutcome?: string): "stop" | "toolUse" | "fail" {
  if (errorMessage || streamOutcome === "error" || stopReason === "error" || stopReason === "abort" || stopReason === "length") {
    return "fail";
  }
  if (stopReason === "toolUse") return "toolUse";
  if (stopReason === "stop") return "stop";
  return "fail";
}

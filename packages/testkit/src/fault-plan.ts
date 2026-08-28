export type CrashPhase = "before-blob" | "after-blob" | "before-descriptor" | "host-visible";

export interface FaultPlan {
  crashAfter?: CrashPhase;
}

export class InjectedCrash extends Error {
  readonly code = "PCR_INJECTED_CRASH";
  constructor(readonly phase: CrashPhase) {
    super("PCR_INJECTED_CRASH");
    this.name = "InjectedCrash";
  }
}

export function crashIf(plan: FaultPlan, phase: CrashPhase): void {
  if (plan.crashAfter === phase) {
    throw new InjectedCrash(phase);
  }
}

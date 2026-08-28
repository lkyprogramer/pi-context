import type { CandidateSnapshot, CandidateWorker } from "../../worker/src/candidate-worker.js";

export interface BackgroundEvent {
  hardPath?: boolean;
  reason?: string;
}

export interface BackgroundRuntime {
  isHardPath?(event: BackgroundEvent): boolean;
  snapshot(): Promise<CandidateSnapshot> | CandidateSnapshot;
  worker: CandidateWorker;
}

export interface BackgroundExtensionAPI {
  on(hook: string, handler: (event: BackgroundEvent, ctx: unknown) => Promise<unknown>): void;
}

export function isHardBackgroundPath(event: BackgroundEvent): boolean {
  return event.hardPath === true || event.reason === "overflow";
}

export function registerBackgroundHook(pi: BackgroundExtensionAPI, runtime: BackgroundRuntime): void {
  pi.on("agent_settled", async (event) => {
    if (runtime.isHardPath?.(event) || isHardBackgroundPath(event)) return;
    const snapshot = await runtime.snapshot();
    await runtime.worker.ensure(snapshot, { wait: false });
  });
}

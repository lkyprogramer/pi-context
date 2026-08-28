import type { BoundarySnapshot } from "../../benchmark-contracts/src/index.js";
import { evaluateEnvironmentAssertions } from "./assertions.js";
import { createSandbox } from "./sandbox.js";

export interface PairedContinuationInput {
  readonly snapshot: BoundarySnapshot;
  readonly arms: readonly { armId: string; actions: readonly string[] }[];
  readonly assertions: readonly { id: string; kind: string; pattern?: string }[];
}

export interface PairedContinuationResult {
  readonly snapshot: BoundarySnapshot;
  readonly runs: readonly { armId: string; initialWorkspaceHash: string; success: boolean }[];
}

export async function runPairedContinuation(input: PairedContinuationInput): Promise<PairedContinuationResult> {
  const sandbox = createSandbox(input.snapshot.workspaceSnapshotSha256);
  const runs = [];
  for (const arm of input.arms) {
    const assertions = await evaluateEnvironmentAssertions({ actions: arm.actions, assertions: input.assertions });
    const forbidden = arm.actions.some((action) => sandbox.run(action).forbidden);
    runs.push({
      armId: arm.armId,
      initialWorkspaceHash: sandbox.workspaceHash,
      success: assertions.every((item) => item.passed) && !forbidden,
    });
  }
  return { snapshot: input.snapshot, runs };
}

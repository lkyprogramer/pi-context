import { sha256Canonical, type ArmManifest, type BoundarySnapshot, type CompressionArtifact, type RawTrace } from "../../benchmark-contracts/src/index.js";
import { createPiHost } from "./pi-host.js";

export interface BenchmarkScenario {
  readonly scenarioId: string;
  readonly family?: string;
}

export interface ContextBudget {
  readonly effectiveInputTokens: number;
  readonly targetVisibleTokens: number;
  readonly retainedTailTokens: number;
}

export interface RecordedOrLiveProvider {
  readonly kind: "recorded" | "live";
  readonly name: string;
  compact(trace: RawTrace, budget: ContextBudget): Promise<{ summary: string; visibleTokens: number; messages: unknown[] }>;
}

export interface ArmRunInput {
  runId: string;
  scenario: BenchmarkScenario;
  trace: RawTrace;
  snapshot: BoundarySnapshot;
  arm: ArmManifest;
  budget: ContextBudget;
  provider: RecordedOrLiveProvider;
  signal?: AbortSignal;
}

export interface ArmRunResult {
  readonly artifact: CompressionArtifact;
  readonly hostEvents: readonly { type: string }[];
  readonly composition: { loadedOwners: readonly string[] };
  readonly rawEvidence: readonly { sha256: string }[];
  readonly hostVisibleMessages: readonly unknown[];
  readonly recallInjections: readonly { itemId: string }[];
}

export async function runPiNativeArm(input: ArmRunInput): Promise<ArmRunResult> {
  if (input.signal?.aborted) {
    throw new Error("aborted");
  }
  if (input.arm.ingress !== "pass-through" || input.arm.compactor !== "pi-native" || input.arm.materializer !== "off") {
    throw new Error("capability mismatch: A0 requires pass-through ingress and pi-native compactor");
  }
  const host = await createPiHost({ owners: ["pi-native"] });
  const session = await host.createSession();
  let compacted;
  try {
    compacted = await input.provider.compact(input.trace, input.budget);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`provider failed: ${message}`);
  }
  const compaction = await session.compact(compacted.summary);
  const artifact: CompressionArtifact = {
    runId: input.runId,
    scenarioId: input.scenario.scenarioId,
    armId: input.arm.armId,
    outputHash: sha256Canonical(compacted.messages),
    sourceTraceHash: input.trace.rawTraceSha256,
    boundaryLeafId: input.snapshot.boundary.leafId,
    visibleTokens: compacted.visibleTokens,
    messages: compacted.messages,
    evidenceRefs: input.trace.entries.map((entry) => entry.entryId),
    omissions: [{ entryId: compaction.entryId, reason: "pi-native compaction" }],
  };
  return {
    artifact,
    hostEvents: session.events(),
    composition: { loadedOwners: host.loadedOwners },
    rawEvidence: [],
    hostVisibleMessages: compacted.messages,
    recallInjections: [],
  };
}

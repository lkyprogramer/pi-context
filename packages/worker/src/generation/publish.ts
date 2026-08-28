import type { GenerationStore, PublishResult } from "../../../storage/src/protocol.js";
import { deriveNextHead, type GenerationManifest } from "./head.js";

export interface PublishInput {
  generationId: string;
  cursor: { sessionId: string; leafId?: string };
  expectedHeadHash: string;
  report: { ok: boolean };
  manifest: GenerationManifest;
  overflow?: boolean;
}

export interface PublishDeps {
  store: GenerationStore;
}

export async function publishVerifiedGeneration(input: PublishInput, deps: PublishDeps): Promise<PublishResult> {
  if (input.overflow) return deps.store.rejectGeneration(input.generationId, "overflow-no-wait");
  if (!input.report.ok) return deps.store.rejectGeneration(input.generationId, "verifier-failed");
  return deps.store.transaction(async (tx) => {
    const existing = await tx.getGeneration?.(input.generationId);
    if (existing?.state === "committed") {
      const head = await tx.getContextHead(input.cursor);
      return { kind: "committed", head, receipt: { generationId: input.generationId, headHash: head.hash } };
    }
    const head = await tx.getContextHead(input.cursor);
    if (head.fencingKey !== input.manifest.fencingKey) {
      return tx.markGenerationStale(input.generationId, "fence-changed");
    }
    if (head.hash !== input.expectedHeadHash) return tx.markGenerationStale(input.generationId, "head-changed");
    await tx.insertGeneration?.(input.manifest, "prepared");
    const next = deriveNextHead(head, input.manifest);
    return tx.compareAndSwapContextHead(head.hash, next, input.generationId);
  });
}

export async function recoverHalfPublished(
  generationId: string,
  deps: PublishDeps,
  cursor: PublishInput["cursor"],
): Promise<PublishResult> {
  return deps.store.transaction(async (tx) => {
    const existing = await tx.getGeneration?.(generationId);
    const head = await tx.getContextHead(cursor);
    if (!existing || existing.state === "prepared") {
      if (head.generationId !== generationId) return tx.markGenerationStale(generationId, "half-published");
    }
    if (existing?.state === "committed") {
      return { kind: "committed", head, receipt: { generationId, headHash: head.hash } };
    }
    return tx.markGenerationStale(generationId, "half-published");
  });
}

export type { PublishResult };

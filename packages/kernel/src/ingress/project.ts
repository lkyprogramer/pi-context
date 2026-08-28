import type { ObservationProjection } from "../../../contracts/src/index.js";
import type { EvidenceUnit } from "../evidence/model.js";

export function projectObservation(input: {
  operationId: string;
  observationId: string;
  rawBlobId: string;
  evidence: EvidenceUnit[];
  visibleText: string;
  isError?: boolean;
  reducer?: { id: string; revision: string };
}): ObservationProjection {
  const text = input.visibleText.slice(0, 2000);
  return {
    operationId: input.operationId,
    observationId: input.observationId,
    rawBlobId: input.rawBlobId,
    evidenceIds: input.evidence.map((item) => item.evidenceId),
    visibleContent: [{ type: "text", text }],
    isError: input.isError === true,
    reducer: input.reducer ?? { id: "default-pointer", revision: "1" },
  };
}

export function hostAckDescriptor(projection: ObservationProjection): { kind: "observation-ack"; observationId: string; evidenceIds: string[] } {
  return {
    kind: "observation-ack",
    observationId: projection.observationId,
    evidenceIds: projection.evidenceIds,
  };
}

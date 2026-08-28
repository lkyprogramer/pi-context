import { domainHash, sourceAuthorityCeiling, type EvidenceUnit } from "../../../contracts/src/index.js";
import { makeEvidenceId, minAuthority, type EvidenceAdmissionInput } from "./model.js";

export function admitEvidence(input: EvidenceAdmissionInput): EvidenceUnit[] {
  if (input.commit && !input.rawBlobId) {
    throw Object.assign(new Error("PCR_SOURCE_REF_MISSING"), { code: "PCR_SOURCE_REF_MISSING" });
  }
  const sourceClass = input.originSourceClass ?? input.sourceClass;
  const ceiling = sourceAuthorityCeiling(sourceClass);
  const observedAt = input.observedAt ?? 0;
  const observationId = input.observationId ?? "ob_unknown";
  return input.reducerFacts.map((fact, index) => ({
    evidenceId: makeEvidenceId(observationId, index, fact),
    observationId,
    kind: fact.kind,
    value: fact.value,
    sourceClass,
    authority: minAuthority(ceiling, fact.requestedAuthority ?? "inform"),
    sourceRefs: input.rawBlobId ? [input.rawBlobId] : [],
    observedAt,
    validity: fact.validity ?? { kind: "point", at: observedAt },
    contentHash: domainHash("evidence-payload", fact.value),
  }));
}

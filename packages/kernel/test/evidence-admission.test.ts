import { describe, expect, it } from "vitest";
import { admitEvidence } from "../src/evidence/admit.js";
import { hostAckDescriptor, projectObservation } from "../src/ingress/project.js";

describe("evidence admission", () => {
  it("does not launder untrusted tool content through an agent-authored reducer", () => {
    const evidence = admitEvidence({
      sourceClass: "untrusted-tool",
      reducerFacts: [{ kind: "outcome", value: "deployed" }],
    } as never);
    expect(evidence.every((item) => item.authority === "inform")).toBe(true);
    expect(evidence.every((item) => item.sourceClass === "untrusted-tool")).toBe(true);
  });

  it("keeps the lowest origin when a trusted channel carries untrusted text", () => {
    const evidence = admitEvidence({
      sourceClass: "trusted-tool",
      originSourceClass: "external-content",
      reducerFacts: [{ kind: "file-state", value: "ok", requestedAuthority: "act" }],
      rawBlobId: "blob_a",
      observationId: "ob_1",
      observedAt: 1,
    });
    expect(evidence[0]?.sourceClass).toBe("external-content");
    expect(evidence[0]?.authority).toBe("inform");
  });

  it("requires sourceRefs before commit", () => {
    expect(() =>
      admitEvidence({
        sourceClass: "trusted-tool",
        reducerFacts: [{ kind: "outcome", value: "ok" }],
        commit: true,
      }),
    ).toThrow(/PCR_SOURCE_REF_MISSING/);
  });

  it("keeps an unsupported outcome informative, not act", () => {
    const evidence = admitEvidence({
      sourceClass: "untrusted-tool",
      reducerFacts: [{ kind: "outcome", value: "deployed", requestedAuthority: "act" }],
      rawBlobId: "blob_a",
      observationId: "ob_1",
    });
    expect(evidence[0]?.authority).toBe("inform");
  });

  it("is idempotent for duplicate admission", () => {
    const input = {
      sourceClass: "trusted-tool" as const,
      reducerFacts: [{ kind: "test-result", value: "fail" }],
      rawBlobId: "blob_a",
      observationId: "ob_1",
      observedAt: 9,
    };
    expect(admitEvidence(input)).toEqual(admitEvidence(input));
    const projection = projectObservation({
      operationId: "op_1",
      observationId: "ob_1",
      rawBlobId: "blob_a",
      evidence: admitEvidence(input),
      visibleText: "fail",
      reducer: { id: "test-log", revision: "1" },
    });
    expect(hostAckDescriptor(projection)).toMatchObject({ kind: "observation-ack", observationId: "ob_1" });
    expect(projection.visibleContent[0]).toMatchObject({ type: "text" });
  });
});

import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createSemanticProvider } from "../../src/semantic/port.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-semantic-port",
    sessionId: "session-semantic",
    leafId: "leaf-semantic",
    lineageEntryIds: ["root", "leaf-semantic"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("semantic provider port", () => {
  it("returns a typed proposal and rejects undeclared source refs", async () => {
    const bound = cursor();
    const provider = createSemanticProvider({
      cursor: bound,
      async generate() {
        return {
          claims: [{
            claimId: "cl_port",
            key: "status",
            polarity: "is",
            status: "active",
            value: "ok",
            sourceRefs: ["ev_known"],
          }],
          continuityPatch: { action: "keep" },
        };
      },
    });
    const proposal = await provider.propose({
      operationId: "op_port",
      cursor: bound,
      sourceRefs: ["ev_known"],
    });
    expect(proposal.proposalId).toMatch(/^[a-f0-9]{64}$/u);
    expect(proposal.claims[0]?.sourceRefs).toEqual(["ev_known"]);
    const other = createSemanticProvider({
      cursor: bound,
      async generate() {
        return {
          claims: [{
            claimId: "cl_port",
            key: "status",
            polarity: "is",
            status: "active",
            value: "ok",
            sourceRefs: ["ev_unknown"],
          }],
        };
      },
    });
    await expect(other.propose({
      operationId: "op_port",
      cursor: bound,
      sourceRefs: ["ev_known"],
    })).rejects.toMatchObject({ code: "PCR_SEMANTIC_INPUT_INVALID" });
  });
});

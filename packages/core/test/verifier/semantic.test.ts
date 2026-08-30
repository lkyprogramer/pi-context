import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/stable-identity.js";
import { createSemanticVerifier } from "../../src/verifier/semantic.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-semantic-verifier",
    sessionId: "session-verifier",
    leafId: "leaf-verifier",
    lineageEntryIds: ["root", "leaf-verifier"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("semantic verifier", () => {
  it("patches uncited claims and keeps cited polarity", async () => {
    const bound = cursor();
    const report = await createSemanticVerifier({ cursor: bound }).verify({
      proposalId: "b".repeat(64),
      sourceRefs: ["ev_keep", "ev_drop"],
      claims: [
        {
          claimId: "cl_keep",
          key: "version",
          polarity: "is",
          status: "active",
          value: "7",
          sourceRefs: ["ev_keep"],
        },
        {
          claimId: "cl_drop",
          key: "ghost",
          polarity: "is",
          status: "active",
          value: "x",
          sourceRefs: ["ev_drop"],
        },
      ],
      continuityPatch: null,
    }, {
      cursor: bound,
      sourceRefs: ["ev_keep"],
      directives: [{ polarity: "is", status: "active", key: "version" }],
    });
    expect(report.ok).toBe(true);
    expect(report.patched.claims.map((item) => item.claimId)).toEqual(["cl_keep"]);
  });
});

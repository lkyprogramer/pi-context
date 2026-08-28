import { describe, expect, it } from "vitest";
import type { HostCheckpoint } from "../../contracts/src/types.js";
import { checkpointTokenPrice } from "../src/compaction/host-checkpoint.js";
import { renderHostCheckpoint } from "../src/compaction/render.js";

function fixtureHostCheckpoint(partial: Partial<HostCheckpoint> = {}): HostCheckpoint {
  return {
    directives: [{ directiveId: "dir_keep", quote: "do not deploy prod", polarity: "must-not", status: "active" }],
    continuity: {
      revisionId: "cr_aaaaaaaa",
      markdown: "front: deploy service",
      unresolvedErrors: [{ id: "err_1", stage: "observed", message: "boom" }],
      externalSideEffects: [{ id: "se_1", kind: "deploy", status: "running-unverified" }],
    },
    claims: [
      {
        claimId: "cl_bbbbbbbb",
        key: "constraint/prod",
        polarity: "must-not",
        status: "active",
        value: "do-not-deploy-prod",
        validTime: { start: 100, end: null },
      },
    ],
    pointers: [{ ref: "blob_opaque", kind: "raw-blob" }],
    heads: {
      contextHead: "ctx_aaaaaaaa",
      directiveHead: "dh_1",
      claimHead: "ch_1",
      continuityHead: "cth_1",
      catalogHead: "cah_1",
    },
    secrets: { "raw secret value": "should-never-render" },
    ...partial,
  };
}

describe("host checkpoint renderer", () => {
  it("renders stable sections and exact opaque head references", () => {
    const text = renderHostCheckpoint(fixtureHostCheckpoint());
    expect(text).toContain("## Active User Directives");
    expect(text).toContain("contextHead: ctx_");
    expect(text).not.toContain("raw secret value");
  });

  it("orders claims by semantic key then ID", () => {
    const text = renderHostCheckpoint(
      fixtureHostCheckpoint({
        claims: [
          { claimId: "cl_b", key: "z/late", polarity: "is", status: "active", value: "b" },
          { claimId: "cl_a2", key: "a/early", polarity: "is", status: "active", value: "a2" },
          { claimId: "cl_a1", key: "a/early", polarity: "is", status: "active", value: "a1" },
        ],
      }),
    );
    expect(text.indexOf("cl_a1")).toBeLessThan(text.indexOf("cl_a2"));
    expect(text.indexOf("a/early")).toBeLessThan(text.indexOf("z/late"));
  });

  it("never emits raw blob plaintext", () => {
    const text = renderHostCheckpoint(
      fixtureHostCheckpoint({
        pointers: [{ ref: "blob_opaque", kind: "raw-blob" }],
        secrets: { "raw secret value": "super-secret-plain" },
      }),
    );
    expect(text).toContain("blob_opaque");
    expect(text).not.toContain("super-secret-plain");
    expect(text).not.toContain("raw secret value");
  });

  it("preserves negation, time, and status", () => {
    const text = renderHostCheckpoint(fixtureHostCheckpoint());
    expect(text).toContain("must-not/active");
    expect(text).toContain("valid=100..open");
    expect(text).toContain("do not deploy prod");
  });

  it("stays under maxCheckpointTokens", () => {
    const text = renderHostCheckpoint(fixtureHostCheckpoint({ maxCheckpointTokens: 400 }));
    expect(checkpointTokenPrice(text)).toBeLessThanOrEqual(400);
    expect(text).toContain("## Active User Directives");
  });
});

import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type SemanticProposal } from "@pcr/contracts";
import { createRuntimeCursor, createSemanticVerifier } from "@pcr/core";

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

function cursor(leafId = "leaf-t36") {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t36",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function proposal(overrides: Partial<SemanticProposal> = {}): SemanticProposal {
  return {
    proposalId: "a".repeat(64),
    sourceRefs: ["ev_t36"],
    claims: [{
      claimId: "cl_t36_version",
      key: "version",
      polarity: "is",
      status: "active",
      value: "7",
      sourceRefs: ["ev_t36"],
    }],
    continuityPatch: { action: "keep" },
    ...overrides,
  };
}

function snapshot(bound = cursor()) {
  return {
    cursor: bound,
    sourceRefs: ["ev_t36"],
    directives: [{ polarity: "is", status: "active", key: "version" }],
  };
}

async function runT36Fixture() {
  const bound = cursor();
  const verifier = createSemanticVerifier({ cursor: bound });
  const accepted = proposal();
  const first = await verifier.verify(accepted, snapshot(bound));
  expect(first.ok).toBe(true);
  expect(first.issues).toEqual([]);
  expect(first.patched.claims).toHaveLength(1);
  expect(first.patched.claims[0]?.polarity).toBe("is");
  const mixed = proposal({
    sourceRefs: ["ev_t36", "ev_invented"],
    claims: [
      ...accepted.claims,
      {
        claimId: "cl_t36_ghost",
        key: "ghost",
        polarity: "is",
        status: "active",
        value: "no",
        sourceRefs: ["ev_invented"],
      },
    ],
  });
  const patched = await verifier.verify(mixed, snapshot(bound));
  expect(patched.ok).toBe(true);
  expect(patched.patched.claims.map((item) => item.claimId)).toEqual(["cl_t36_version"]);
  expect(patched.issues.some((item) => item.code === "UNCITED_CLAIM")).toBe(true);
  const second = await verifier.verify(accepted, snapshot(bound));
  expect(second).toEqual(first);
  return { ok: true as const, task: "T36" as const, report: first };
}

describe("T36 Deterministic semantic verifier and patcher", () => {
  it("deterministic_semantic_verifier_and_patcher", async () => {
    await expect(runT36Fixture()).resolves.toMatchObject({ ok: true, task: "T36" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createSemanticVerifier({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_VERIFIER_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed proposals and empty claims", async () => {
    const bound = cursor();
    const verifier = createSemanticVerifier({ cursor: bound });
    await expect(verifier.verify({} as never, snapshot(bound))).rejects.toMatchObject({
      code: "PCR_VERIFIER_INPUT_INVALID",
    });
    await expect(verifier.verify(proposal({ claims: [], sourceRefs: [] }), snapshot(bound))).rejects.toMatchObject({
      code: "PCR_VERIFIER_INPUT_INVALID",
    });
  });

  it("replays equal verification for the same proposal and snapshot", async () => {
    const bound = cursor();
    const verifier = createSemanticVerifier({ cursor: bound });
    const input = proposal();
    const first = await verifier.verify(input, snapshot(bound));
    const second = await verifier.verify(input, snapshot(bound));
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
  });

  it("rejects a snapshot cursor from another workspace", async () => {
    const bound = cursor();
    const verifier = createSemanticVerifier({ cursor: bound });
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t36",
      leafId: "leaf-t36",
      lineageEntryIds: ["root", "leaf-t36"],
      modelKey: bound.modelKey,
    });
    await expect(verifier.verify(proposal(), { ...snapshot(bound), cursor: other })).rejects.toMatchObject({
      code: "PCR_VERIFIER_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before inspecting claims", async () => {
    const bound = cursor();
    const verifier = createSemanticVerifier({ cursor: bound });
    await expect(verifier.verify(proposal(), {
      ...snapshot(bound),
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
  });

  it("fails closed when a proposal rewrites an active directive to must-not", async () => {
    const bound = cursor();
    const verifier = createSemanticVerifier({ cursor: bound });
    const rewritten = proposal({
      claims: [{
        claimId: "cl_t36_version",
        key: "version",
        polarity: "must-not",
        status: "active",
        value: "7",
        sourceRefs: ["ev_t36"],
      }],
    });
    const report = await verifier.verify(rewritten, snapshot(bound));
    expect(report.ok).toBe(false);
    expect(report.issues.some((item) => item.code === "POLARITY_REWRITE")).toBe(true);
    expect(report.patched.claims[0]?.polarity).toBe("must-not");
  });
});

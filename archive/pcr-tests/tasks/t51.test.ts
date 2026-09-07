import { describe, expect, it } from "vitest";

import { createMvpAcceptance } from "../../scripts/gates/deterministic-mvp.mjs";

const WORKSPACE = "ws-t51";

function ports(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    vertical: { async probe() { return true; } },
    recovery: { async probe() { return true; } },
    w1: { async evaluate() { return true; } },
    w2: { async decide() { return "keep-pi-native"; } },
    findings: { async p0Open() { return 0; } },
    ...overrides,
  };
}

async function runT51Fixture() {
  const mvp = createMvpAcceptance(ports());
  const verdict = await mvp.accept({ workspaceId: WORKSPACE });
  expect(verdict).toEqual({
    vertical: true,
    recovery: true,
    w1Gate: true,
    w2Decision: "keep-pi-native",
    p0Open: 0,
  });
  const blocked = await createMvpAcceptance(ports({
    vertical: { async probe() { return false; } },
    findings: { async p0Open() { return 2; } },
    w2: { async decide() { return "stop"; } },
  })).accept({ workspaceId: WORKSPACE });
  expect(blocked.vertical).toBe(false);
  expect(blocked.w1Gate).toBe(false);
  expect(blocked.p0Open).toBe(2);
  expect(blocked.w2Decision).toBe("stop");
  return { ok: true as const, task: "T51" as const, verdict };
}

describe("T51 End-to-end deterministic MVP acceptance", () => {
  it("end_to_end_deterministic_mvp_acceptance", async () => {
    await expect(runT51Fixture()).resolves.toMatchObject({ ok: true, task: "T51" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createMvpAcceptance({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_MVP_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed accept input", async () => {
    await expect(createMvpAcceptance(ports()).accept({} as never)).rejects.toMatchObject({
      code: "PCR_MVP_INPUT_INVALID",
    });
  });

  it("replays equal verdicts for the same probes", async () => {
    const mvp = createMvpAcceptance(ports());
    const first = await mvp.accept({ workspaceId: WORKSPACE });
    const second = await mvp.accept({ workspaceId: WORKSPACE });
    expect(second).toEqual(first);
  });

  it("denies accept from another workspace", async () => {
    await expect(createMvpAcceptance(ports()).accept({ workspaceId: "ws-other" })).rejects.toMatchObject({
      code: "PCR_MVP_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before probing", async () => {
    let probes = 0;
    const mvp = createMvpAcceptance(ports({
      vertical: { async probe() { probes += 1; return true; } },
      recovery: { async probe() { probes += 1; return true; } },
      w1: { async evaluate() { probes += 1; return true; } },
      w2: { async decide() { probes += 1; return "stop"; } },
      findings: { async p0Open() { probes += 1; return 0; } },
    }));
    await expect(mvp.accept({ workspaceId: WORKSPACE, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(probes).toBe(0);
  });
});

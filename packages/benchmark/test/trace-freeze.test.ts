import { describe, expect, it } from "vitest";

import { freezeA1Trace } from "@pcr/benchmark";

describe("A1-shaped frozen Pi trace", () => {
  it("copies the same input hash to B0/B1/B2 and isolates mutations", () => {
    const frozen = freezeA1Trace({
      sessionJsonl: `${JSON.stringify({ role: "user", text: "keep version 7", ingress: "tool_result" })}\n`,
      workspaceSnapshot: { files: { "src/app.ts": "export const version = 7;\n" } },
      hostAck: true,
    });
    expect(frozen.hostAck).toBe(true);
    expect(frozen.ingressExecuted).toBe(true);
    expect(frozen.copies.B0.inputHash).toBe(frozen.copies.B1.inputHash);
    expect(frozen.copies.B1.inputHash).toBe(frozen.copies.B2.inputHash);
    (frozen.copies.B0.workspaceSnapshot as { files: Record<string, string> }).files["src/app.ts"] = "mutated";
    expect((frozen.copies.B1.workspaceSnapshot as { files: Record<string, string> }).files["src/app.ts"]).toBe(
      "export const version = 7;\n",
    );
  });

  it("rejects a freeze without host ack", () => {
    expect(() => freezeA1Trace({
      sessionJsonl: "{}\n",
      workspaceSnapshot: {},
      hostAck: false,
    })).toThrowError(expect.objectContaining({ code: "PCR_TRACE_INPUT_INVALID" }));
  });
});

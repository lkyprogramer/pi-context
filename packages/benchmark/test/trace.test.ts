import { describe, expect, it } from "vitest";

import { createTraceCapture } from "@pcr/benchmark";

describe("trace capture redaction", () => {
  it("does not keep live tokens in the captured identity", async () => {
    const capture = createTraceCapture({
      corpusId: "pcr-bench",
      clusters: { temporal: ["temporal-00"] },
      store: { async write() {} },
    });
    const trace = await capture.capture({
      clusterId: "temporal",
      workspaceId: "ws-t41",
      sessionId: "session-t41",
      sessionJsonl: `${JSON.stringify({
        type: "message",
        id: "u1",
        role: "user",
        workspaceId: "ws-t41",
        sessionId: "session-t41",
        text: "token sk-live-t41-secret",
      })}\n`,
      workspaceSnapshot: { files: {} },
    });
    expect(JSON.stringify(trace)).not.toContain("sk-live-t41-secret");
    expect(trace.sessionJsonlHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

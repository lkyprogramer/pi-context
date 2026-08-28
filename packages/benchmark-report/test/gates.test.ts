import { describe, expect, it } from "vitest";
import { evaluateBenchmarkGate } from "../src/gates.js";
import { reportFixture, w1PartialFixture } from "./fixtures.js";

describe("w1 gate", () => {
  it("stops on integrity failure despite large token savings", () => {
    const d = evaluateBenchmarkGate(reportFixture({ integrityPass: false, ingressTokenMedianDelta: -0.9 }));
    expect(d.decision).toBe("stop");
  });

  it("returns keep-reducers-only when ingress passes but proactive recall fails", () => {
    const d = evaluateBenchmarkGate(w1PartialFixture());
    expect(d.decision).toBe("keep-reducers-only");
  });
});

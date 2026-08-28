import { describe, expect, it } from "vitest";
import { balancedPolicy, decideHostConvergence } from "../src/control/convergence.js";

describe("host convergence", () => {
  it("compacts before full-history clone cost becomes unbounded", () => {
    const decision = decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.52, grewSinceLast: 400 }, balancedPolicy());
    expect(decision).toMatchObject({ kind: "compact", reason: "clone-cost" });
  });

  it("never compacts while streaming or mid-tool", () => {
    const policy = balancedPolicy();
    expect(
      decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.95, grewSinceLast: 400, streaming: true }, policy),
    ).toMatchObject({ kind: "defer", reason: "in-flight" });
    expect(
      decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.95, grewSinceLast: 400, midTool: true }, policy),
    ).toMatchObject({ kind: "defer", reason: "in-flight" });
  });

  it("honors cooldown and minimum growth hysteresis", () => {
    const policy = balancedPolicy();
    expect(
      decideHostConvergence({ messageCount: 10, cloneP95Ms: 10, pressure: 0.75, grewSinceLast: 400, cooldownActive: true, atBoundary: true }, policy),
    ).toMatchObject({ kind: "defer", reason: "cooldown" });
    expect(
      decideHostConvergence({ messageCount: 10, cloneP95Ms: 10, pressure: 0.4, grewSinceLast: 10 }, policy),
    ).toMatchObject({ kind: "defer", reason: "growth" });
  });

  it("defers queued messages unless overflow", () => {
    const policy = balancedPolicy();
    expect(
      decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.52, grewSinceLast: 400, queuedMessages: 2 }, policy),
    ).toMatchObject({ kind: "defer", reason: "queued" });
    expect(
      decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.52, grewSinceLast: 400, queuedMessages: 2, overflow: true }, policy),
    ).toMatchObject({ kind: "compact", reason: "overflow" });
  });

  it("does not loop after a compaction failure", () => {
    const policy = balancedPolicy();
    expect(
      decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.52, grewSinceLast: 400, lastCompactFailed: true }, policy),
    ).toMatchObject({ kind: "defer", reason: "no-loop" });
  });
});


import { describe, expect, it } from "vitest";
import { bindInputCorrelation } from "../../packages/pi-adapter/src/input-correlation.js";
import { InputCorrelator } from "../../packages/kernel/src/directives/raw-input.js";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

describe("Pi input correlation", () => {
  it("correlates a Pi input event to the later user message_end", async () => {
    const harness = createPiContractHarness();
    const correlator = new InputCorrelator();
    bindInputCorrelation(harness.host, correlator);
    await harness.host.emit("input", {
      content: { sessionId: "s1", source: "interactive", text: "/skill:review src/x.ts", at: 10 },
    });
    await harness.host.emit("message_end", {
      content: { hostMessageId: "m1", expandedText: "<skill>...\nsrc/x.ts", at: 11, sessionId: "s1" },
    });
    const linked = correlator.latestLinked("s1");
    expect(linked?.rawText).toBe("/skill:review src/x.ts");
    expect(linked?.hostMessageId).toBe("m1");
  });
});

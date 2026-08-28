import { describe, expect, it } from "vitest";
import { bindToolResultCapture } from "../../packages/pi-adapter/src/tool-result-hook.js";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

describe("Pi tool_result order", () => {
  it("captures raw content before the host-visible result is passed through", async () => {
    const harness = createPiContractHarness();
    const events: string[] = [];
    bindToolResultCapture(harness.host, {
      onEvent: (name) => events.push(name),
    });
    const result = await harness.host.emit("tool_result", {
      content: [{ type: "text", text: "full" }],
    });
    expect(events[0]).toBe("blob-published");
    expect(events).toContain("receipt-prepared");
    expect(result.errors).toEqual([]);
  });
});

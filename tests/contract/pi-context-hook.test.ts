import { describe, expect, it } from "vitest";
import { toHostMessages, toPiMessages } from "../../packages/pi-adapter/src/message-conversion.js";
import { createPiHarnessWithRuntime } from "../support/pi.js";

function fixturePiMessages() {
  return [
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "now" },
  ];
}

describe("Pi context hook", () => {
  it("returns materialized messages before convertToLlm and aborts on hard safety failure", async () => {
    const host = await createPiHarnessWithRuntime({ materializeError: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    const messages = await host.emitContext(fixturePiMessages());
    expect(host.abortCalls).toBe(1);
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("does not let a handler exception escape the hook", async () => {
    const host = await createPiHarnessWithRuntime({
      materializeError: "PCR_DIRECTIVE_BUDGET_EXCEEDED",
    });
    await expect(host.emitContext(fixturePiMessages())).resolves.toEqual(expect.any(Array));
  });

  it("converts custom, compaction, and branch summaries to agent-derived custom messages", () => {
    const host = toHostMessages([
      { role: "custom", content: "aside" },
      { role: "compaction", content: "summary" },
      { role: "branch-summary", content: "fork" },
    ]);
    expect(host.every((item) => item.role === "custom")).toBe(true);
    expect(host.every((item) => item.sourceClass === "agent-derived")).toBe(true);
    expect(toPiMessages(host).map((item) => item.role)).toEqual(["custom", "custom", "custom"]);
  });

  it("keeps the original user last after a successful materialization", async () => {
    const host = await createPiHarnessWithRuntime();
    const messages = await host.emitContext(fixturePiMessages());
    expect(host.abortCalls).toBe(0);
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("labels unsupported custom content as agent-derived", () => {
    const [converted] = toHostMessages([{ role: "unknown-plugin", content: { weird: true } }]);
    expect(converted?.role).toBe("custom");
    expect(converted?.sourceClass).toBe("agent-derived");
  });
});

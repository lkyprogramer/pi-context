import { describe, expect, it } from "vitest";
import { probePiCapabilities } from "../../packages/pi-adapter/src/capabilities.js";
import { createFakePiHost } from "../../packages/testkit/src/fake-pi-host.js";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

describe("Pi capability probe", () => {
  it("fails closed when a load-bearing hook is unavailable", () => {
    const result = probePiCapabilities(new Set(["context", "tool_result"]));
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("session_before_compact");
  });

  it("chains context and tool_result handlers in registration order", async () => {
    const host = createFakePiHost();
    const seen: string[] = [];
    host.on("context", () => {
      seen.push("a");
    });
    host.on("context", () => {
      seen.push("b");
    });
    host.on("tool_result", () => {
      seen.push("c");
    });
    await host.emit("context", { messages: [] });
    await host.emit("tool_result", { content: [] });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("records handler exceptions and continues the pipeline", async () => {
    const host = createFakePiHost();
    const seen: string[] = [];
    host.on("context", () => {
      throw new Error("boom");
    });
    host.on("context", () => {
      seen.push("continued");
    });
    const result = await host.emit("context", { messages: [] });
    expect(result.errors.map((error) => error.message)).toContain("boom");
    expect(seen).toEqual(["continued"]);
  });

  it("excludes custom entries from fake LLM context", () => {
    const harness = createPiContractHarness();
    const messages = harness.llmContext([
      { role: "user", content: "hi" },
      { role: "custom", content: "receipt" },
      { role: "assistant", content: "ok" },
    ]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});

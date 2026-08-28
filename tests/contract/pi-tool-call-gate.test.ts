import { describe, expect, it } from "vitest";
import { bindToolCallGate } from "../../packages/pi-adapter/src/index.js";
import { createFakePiHost } from "../../packages/testkit/src/fake-pi-host.js";

describe("Pi tool_call gate", () => {
  it("returns a model-visible safe error instead of executing a blocked call", async () => {
    const host = createFakePiHost();
    const seen: unknown[] = [];
    bindToolCallGate(host, {
      authorize: async () => ({ kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING" }),
      onBlocked: (result) => seen.push(result),
    });
    await host.emit("tool_call", { content: { toolName: "deploy", args: { target: "prod" } } });
    expect(seen[0]).toMatchObject({ isError: true, code: "PCR_ACTION_AUTHORITY_MISSING" });
  });
});

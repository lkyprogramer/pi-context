import { describe, expect, it } from "vitest";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";

describe("T20 host event matrix", () => {
  it("wires native lifecycle events without input takeover", () => {
    const events: string[] = [];
    const pi: PiExtensionAPI = {
      on(event) { events.push(event); },
      registerTool() {},
      registerCommand() {},
    };
    bindHooks(pi);
    expect(events).toEqual(expect.arrayContaining([
      "session_start", "context", "tool_result", "before_provider_request", "message_end",
      "session_compact", "session_shutdown", "agent_settled",
    ]));
    expect(events).not.toContain("session_before_compact");
    expect(events).not.toContain("input");
  });
});

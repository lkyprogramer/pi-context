import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

import { PiRpc } from "./pi-rpc.js";

function rpc(): PiRpc {
  return new PiRpc({ cliPath: "unused", cwd: process.cwd(), env: {}, args: [] });
}

describe("Pi RPC prompt acceptance", () => {
  it.each([false, undefined])("rejects a prompt without explicit acceptance (%s)", async (success) => {
    const client = rpc();
    vi.spyOn(client, "request").mockResolvedValue({ type: "response", success, error: "prompt rejected" });
    await expect(client.promptAndWait("next prompt", 100)).rejects.toThrow("prompt rejected");
  });

  it("waits for settlement after an accepted prompt", async () => {
    const client = rpc();
    vi.spyOn(client, "request").mockImplementation(async () => {
      client.events.push({ type: "agent_settled" });
      return { type: "response", success: true };
    });
    await expect(client.promptAndWait("next prompt", 200)).resolves.toEqual([{ type: "agent_settled" }]);
  });
});

describe("Pi RPC lifecycle failures", () => {
  it.each(["no-ack", "no-settlement", "exit-after-ack"])("invalidates the client after %s", async (message) => {
    const client = new PiRpc({
      cliPath: fileURLToPath(new URL("../fixtures/pi-rpc-lifecycle.cjs", import.meta.url)),
      cwd: process.cwd(), env: process.env, args: [],
    });
    await client.start();
    try {
      await expect(client.promptAndWait(message, 200)).rejects.toThrow(/settle|Timeout|timed out|exited/);
      await expect(client.request({ type: "prompt", message: "next" })).rejects.toThrow(/settle|Timeout|timed out|exited/);
    } finally {
      await client.stop();
    }
  });
});

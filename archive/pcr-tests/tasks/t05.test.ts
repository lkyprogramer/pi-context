import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  createPi0844HookFixtures,
  probePi0844PublicApi,
} from "../../packages/pi-adapter/src/contracts/pi-0844.js";

const extensionPath = fileURLToPath(new URL("../pi-contract/fixtures/pi-0844-extension.ts", import.meta.url));

async function runT05Fixture() {
  const probe = await probePi0844PublicApi({ expectedVersion: "0.84.4", cwd: process.cwd(), extensionPath });
  return { ok: probe.ready, probe, task: "T05" as const };
}

describe("T05 Pi 0.84.4 public API contract harness", () => {
  it("pi_0_84_4_public_api_contract_harness", async () => {
    const result = await runT05Fixture();

    expect(result).toMatchObject({ ok: true, task: "T05" });
    expect(result.probe).toMatchObject({
      version: "0.84.4",
      capabilities: { context: true, toolResult: true, compaction: true, lifecycle: true },
      missing: [],
    });
    expect(result.probe.handlers).toEqual([
      "agent_settled",
      "context",
      "input",
      "input_result",
      "message_end",
      "model_select",
      "session_before_compact",
      "session_compact",
      "session_compact_failed",
      "session_shutdown",
      "session_start",
      "session_tree",
      "tool_result",
    ]);
  });

  it("builds hook fixtures that preserve real Pi 0.84.4 event envelopes", () => {
    const fixtures = createPi0844HookFixtures();

    expect(fixtures.context).toEqual({ type: "context", messages: [] });
    expect(fixtures.toolResult).toEqual({
      type: "tool_result",
      toolName: "pcr_contract_probe",
      toolCallId: "call-contract",
      input: { probe: true },
      content: [{ type: "text", text: "contract" }],
      isError: false,
      details: { source: "contract" },
    });
    expect(fixtures.sessionStart).toEqual({ type: "session_start", reason: "startup" });
    expect(fixtures.sessionTree).toEqual({
      type: "session_tree",
      oldLeafId: "entry-old",
      newLeafId: "entry-new",
    });
  });

  it("rejects a stale requested Pi version", async () => {
    await expect(probePi0844PublicApi({ expectedVersion: "0.84.3", cwd: process.cwd(), extensionPath })).rejects.toThrow(
      "expected Pi 0.84.3 but loaded 0.84.4",
    );
  });

  it("rejects an empty workspace scope", async () => {
    await expect(probePi0844PublicApi({ expectedVersion: "0.84.4", cwd: "", extensionPath })).rejects.toThrow("cwd");
  });

  it("fails closed when cancelled before the public loader runs", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      probePi0844PublicApi({ expectedVersion: "0.84.4", cwd: process.cwd(), extensionPath, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("is deterministic and idempotent", async () => {
    const first = await probePi0844PublicApi({ expectedVersion: "0.84.4", cwd: process.cwd(), extensionPath });
    const second = await probePi0844PublicApi({ expectedVersion: "0.84.4", cwd: process.cwd(), extensionPath });

    expect(second).toEqual(first);
  });
});

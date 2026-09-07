import { describe, expect, it } from "vitest";
import { createPiHarnessWithRuntime } from "../support/pi.js";

describe("compaction takeover", () => {
  it("uses the host preparation cut point and commits runtime generation only after session_compact", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.compact("threshold");
    expect(host.events).toEqual(expect.arrayContaining(["session_before_compact", "host-compaction-written", "session_compact", "runtime-generation-committed"]));
    expect(host.indexOf("runtime-generation-committed")).toBeGreaterThan(host.indexOf("session_compact"));
    expect(host.lastCompaction?.firstKeptEntryId).toBe("entry_tail");
    expect(host.lastCompaction?.fromExtension).toBe(true);
    expect(host.lastCompaction?.details.schemaVersion).toBe(1);
    expect(host.lastCompaction?.details.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles manual instructions by policy and does not reuse a stale candidate", async () => {
    const denied = await createPiHarnessWithRuntime();
    await denied.compact("manual", { allowManual: false });
    expect(denied.events).toContain("session_compact_failed");
    expect(denied.events).not.toContain("runtime-generation-committed");

    const host = await createPiHarnessWithRuntime();
    await host.compact("manual");
    expect(host.events.filter((item) => item === "runtime-generation-committed")).toHaveLength(1);
    await host.compact("manual", { reuseStale: true });
    expect(host.events.filter((item) => item === "runtime-generation-committed")).toHaveLength(1);
  });

  it("uses the deterministic path on overflow", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.compact("overflow");
    expect(host.lastPath).toBe("deterministic");
    expect(host.events).toContain("runtime-generation-committed");
    expect(host.lastCompaction?.fromExtension).toBe(true);
  });

  it("does not commit runtime generation when compaction is cancelled", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.compact("threshold", { cancel: true });
    expect(host.events).toContain("session_before_compact");
    expect(host.events).toContain("host-compaction-written");
    expect(host.events).toContain("session_compact_failed");
    expect(host.events).not.toContain("session_compact");
    expect(host.events).not.toContain("runtime-generation-committed");
  });
});

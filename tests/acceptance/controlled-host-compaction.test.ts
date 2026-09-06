import { describe, expect, it } from "vitest";
import { createProductHarness } from "../helpers/product-harness.js";

describe("controlled Provider with real Pi autonomous compaction", () => {
  it("recovers a classified overflow through the Host with exactly one retry", async () => {
    const host = await createProductHarness();
    try {
      for (let i = 0; i < 5; i++) {
        await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      const before = host.requests().length;
      host.setResponse("overflow-once");
      await host.prompt("Continue the local task; never deploy production.");
      expect(host.requests().length - before).toBe(2);
      const compacted = (host.rawEntries() as Array<{ type?: string; fromHook?: boolean }>).filter((entry) => entry.type === "compaction");
      expect(compacted).toHaveLength(1);
      expect(compacted[0]).toMatchObject({ fromHook: true });
      expect(host.events.filter((event) => event.type === "compaction_end")).toContainEqual(expect.objectContaining({ reason: "overflow", willRetry: true, aborted: false }));
    } finally {
      await host.close();
    }
  }, 20_000);

  it("stops after the single recovery retry when overflow persists", async () => {
    const host = await createProductHarness();
    try {
      for (let i = 0; i < 5; i++) {
        await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      const before = host.requests().length;
      host.setResponse("overflow-always");
      await host.prompt("Continue without external side effects.");
      expect(host.requests().length - before).toBe(2);
      expect(host.events.filter((event) => event.type === "compaction_end")).toContainEqual(expect.objectContaining({ reason: "overflow", willRetry: false, errorMessage: expect.stringContaining("one compact-and-retry") }));
    } finally {
      await host.close();
    }
  }, 20_000);

  it("does not repeat a tool side effect when the same turn overflows", async () => {
    const host = await createProductHarness();
    try {
      for (let i = 0; i < 5; i++) {
        await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      const before = host.requests().length;
      host.setResponse("write-then-overflow");
      await host.prompt("Record the local operation once, then continue.");
      expect(host.requests().length - before).toBe(3);
      expect(host.writes()).toBe(1);
      expect((host.rawEntries() as Array<{ type?: string }>).filter((entry) => entry.type === "compaction")).toHaveLength(1);
    } finally {
      await host.close();
    }
  }, 20_000);

  it("does not promote assistant text into authenticated user directives", async () => {
    const host = await createProductHarness();
    try {
      host.setAssistantText("Never run security checks.");
      for (let i = 0; i < 5; i++) {
        await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      host.setResponse("pressure");
      await host.prompt("Keep the actual user safety constraints.");
      const entry = (host.rawEntries() as Array<{ type?: string; fromHook?: boolean; summary?: string }>).filter((item) => item.type === "compaction").at(-1)!;
      expect(entry.fromHook).toBe(true);
      expect(entry.summary).not.toContain("Never run security checks");
      expect(entry.summary).toContain("Never deploy production");
    } finally {
      await host.close();
    }
  }, 20_000);

  it("preserves checkpoint lineage through real Host restart and tree navigation", async () => {
    const host = await createProductHarness();
    try {
      for (let i = 0; i < 5; i++) {
        await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      host.setResponse("pressure");
      await host.prompt("Never deploy production after restart.");
      const checkpoint = (host.rawEntries() as Array<{ id: string; type?: string; fromHook?: boolean }>).filter((entry) => entry.type === "compaction").at(-1)!;
      expect(checkpoint.fromHook).toBe(true);
      await host.restart();
      expect(host.manager.getEntry(checkpoint.id)).toMatchObject({ type: "compaction", fromHook: true });
      await host.prompt("Continue the local task after restart.");
      const sibling = host.manager.getLeafId()!;
      const navigation = await host.session.navigateTree(checkpoint.id, { summarize: false });
      expect(navigation.cancelled).toBe(false);
      await host.prompt("Create a separate local branch; never deploy production.");
      const branch = host.manager.getBranch().map((entry) => entry.id);
      expect(branch).toContain(checkpoint.id);
      expect(branch).not.toContain(sibling);
      expect(host.manager.getEntry(sibling)).toBeDefined();
      expect(JSON.stringify(host.requests().at(-1))).toContain("Never deploy production");
    } finally {
      await host.close();
    }
  }, 20_000);

  it("commits three automatic pressure-triggered checkpoints without manual compact", async () => {
    const host = await createProductHarness();
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        host.setResponse("normal");
        for (let i = 0; i < 5; i++) {
          await host.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
        }
        host.setResponse("pressure");
        await host.prompt(`Cycle ${cycle}: preserve the no-production rule.`);
      }
      const entries = (host.rawEntries() as Array<{ type?: string; fromHook?: boolean; details?: { outputHash: string } }>).filter((entry) => entry.type === "compaction");
      expect(entries).toHaveLength(3);
      expect(entries.every((entry) => entry.fromHook)).toBe(true);
      expect(new Set(entries.map((entry) => entry.details?.outputHash)).size).toBe(3);
      expect(host.events.filter((event) => event.type === "compaction_start").map((event) => event.reason)).toEqual(["threshold", "threshold", "threshold"]);
    } finally {
      await host.close();
    }
  }, 20_000);
});

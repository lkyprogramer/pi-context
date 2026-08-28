import { describe, expect, it } from "vitest";
import { createPiHarnessWithRuntime } from "../support/pi.js";

describe("session lifecycle", () => {
  it("switches branch scope without pretending external side effects rolled back", async () => {
    const host = await createPiHarnessWithRuntime({ existingSideEffect: "process-42" });
    await host.navigateTree("old-leaf");
    expect(host.runtimeCursor.branchScope).not.toBe(host.previousBranchScope);
    expect(host.continuity.externalSideEffects[0].status).toBe("requires-revalidation");
    expect(host.closedPreviousWorker).toBe(true);
  });

  it("catch-up distinguishes new/resume/fork/reload and degrades legacy sessions without raw blobs", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.startSession("new", true);
    expect(host.catchUp).toMatchObject({ reason: "new", pointerUnavailable: false, degraded: false });
    await host.startSession("resume", false);
    expect(host.catchUp).toMatchObject({ reason: "resume", pointerUnavailable: true, degraded: true });
    await host.startSession("fork", true);
    expect(host.catchUp).toMatchObject({ reason: "fork", pointerUnavailable: false });
    await host.startSession("reload", false);
    expect(host.catchUp).toMatchObject({ reason: "reload", pointerUnavailable: true });
  });

  it("shutdown closes the session worker", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.startSession("new");
    expect(host.workerOpen).toBe(true);
    await host.shutdown();
    expect(host.workerOpen).toBe(false);
  });

  it("changes lineage hash when switching branches", async () => {
    const host = await createPiHarnessWithRuntime();
    const before = host.runtimeCursor.lineageHash;
    await host.navigateTree("leaf-b");
    expect(host.runtimeCursor.lineageHash).not.toBe(before);
    expect(host.runtimeCursor.branchScope).toContain("leaf-b");
  });
});

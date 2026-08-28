import { afterEach, describe, expect, it } from "vitest";
import { createPiContextExtension } from "../src/extension.js";
import { claimPiContextOwner, resetOwnerForTest } from "../src/owner.js";
import { createSessionRuntime } from "../src/runtime.js";

afterEach(resetOwnerForTest);

describe("single owner", () => {
  it("rejects a second runtime in the same process", () => {
    const first = claimPiContextOwner("instance-a");
    expect(() => claimPiContextOwner("instance-b")).toThrowError(/PCR_OWNER_ALREADY_CLAIMED/);
    first.release();
    expect(() => claimPiContextOwner("instance-b")).not.toThrow();
  });

  it("does not register hooks before owner claim succeeds", () => {
    const pending = createPiContextExtension();
    expect(pending.hooks).toEqual({});
    expect(pending.claimed).toBe(false);
    const started = createPiContextExtension({ claimOnCreate: true });
    expect(started.claimed).toBe(true);
    expect(() => createPiContextExtension({ claimOnCreate: true })).toThrowError(/PCR_OWNER_ALREADY_CLAIMED/);
  });

  it("session shutdown releases only that session, not the process owner", () => {
    const owner = claimPiContextOwner("runtime");
    const session = createSessionRuntime("s1");
    session.shutdown();
    expect(() => claimPiContextOwner("other")).toThrowError(/PCR_OWNER_ALREADY_CLAIMED/);
    owner.release();
  });

  it("reload does not leave duplicate timers or worker ports", () => {
    const first = createSessionRuntime("s1");
    first.schedule("tick", () => undefined);
    first.shutdown();
    const second = createSessionRuntime("s1");
    expect(second.activeHandles()).toBe(0);
    second.shutdown();
  });
});

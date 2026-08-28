import { describe, expect, it } from "vitest";
import { registerBackgroundHook } from "../../pi-adapter/src/background-hook.js";
import { candidateKey } from "../src/candidate-key.js";
import { candidateWorkerFixture, fixtureSnapshot } from "./support.js";

describe("CandidateWorker", () => {
  it("marks work stale when branch or model changes before publication", async () => {
    const fx = candidateWorkerFixture();
    const job = fx.start();
    fx.changeCursor({ leafId: "new-leaf", modelKey: "new-model" });
    await job;
    expect(fx.state()).toBe("stale");
    expect(fx.publishCount()).toBe(0);
    expect(fx.metrics().stale).toBe(1);
    expect(fx.metrics().wastedTokens).toBeGreaterThan(0);
    expect(fx.metrics().readyHit).toBe(0);
  });

  it("prepares without publishing when the snapshot stays current", async () => {
    const fx = candidateWorkerFixture();
    const prepared = await fx.start();
    expect(prepared.phase).toBe("prepared");
    expect(fx.state()).toBe("prepared");
    expect(fx.publishCount()).toBe(0);
  });

  it("binds candidate key to cursor model config schema and reducer revisions", () => {
    const base = fixtureSnapshot();
    const shifted = [
      fixtureSnapshot({ leafId: "leaf-b" }),
      fixtureSnapshot({ modelKey: "model-b" }),
      fixtureSnapshot({ configFingerprint: "cfg-2" }),
      fixtureSnapshot({ schemaVersion: "2" }),
      fixtureSnapshot({ reducerRevisionSet: "red-2" }),
      fixtureSnapshot({ sourceHead: "src-2" }),
    ];
    expect(new Set([candidateKey(base), ...shifted.map(candidateKey)]).size).toBe(1 + shifted.length);
  });

  it("cancels and drains on session shutdown", async () => {
    const fx = candidateWorkerFixture({ prepareMs: 40 });
    const job = fx.start();
    await fx.shutdown();
    await expect(job).resolves.toMatchObject({ phase: "cancelled" });
    expect(fx.state()).toBe("cancelled");
    expect(fx.publishCount()).toBe(0);
  });

  it("keeps at most one active job per key", async () => {
    const fx = candidateWorkerFixture({ prepareMs: 20 });
    const first = fx.start();
    const second = fx.start();
    expect(second).toBe(first);
    await first;
    expect(fx.state()).toBe("prepared");
  });

  it("fails closed when queue disk or model budgets are exceeded", async () => {
    const queued = candidateWorkerFixture({
      prepareMs: 30,
      budgets: { maxActiveJobs: 1, maxQueue: 0 },
    });
    const first = queued.start();
    const overflow = await queued.start({ leafId: "leaf-b", sourceHead: "src-2" });
    expect(overflow.phase).toBe("failed");
    expect(overflow.reason).toBe("queue-budget");
    await first;

    const disk = candidateWorkerFixture({ budgets: { maxDiskBytes: 16 } });
    await disk.start();
    const diskOverflow = await disk.start({ leafId: "leaf-c", sourceHead: "src-3" });
    expect(diskOverflow.phase).toBe("failed");
    expect(diskOverflow.reason).toBe("resource-budget");

    const model = candidateWorkerFixture({ budgets: { maxModelTokens: 8 } });
    await model.start();
    const modelOverflow = await model.start({ leafId: "leaf-d", sourceHead: "src-4" });
    expect(modelOverflow.phase).toBe("failed");
    expect(modelOverflow.reason).toBe("resource-budget");
  });

  it("hard path never waits for the worker", async () => {
    const fx = candidateWorkerFixture({ prepareMs: 40 });
    const started = Date.now();
    const immediate = await fx.startNoWait();
    expect(Date.now() - started).toBeLessThan(20);
    expect(immediate.phase).toBe("preparing");

    const hooks: Record<string, (event: { hardPath?: boolean; reason?: string }) => Promise<unknown>> = {};
    let ensureCalls = 0;
    registerBackgroundHook(
      {
        on(hook, handler) {
          hooks[hook] = handler;
        },
      },
      {
        snapshot: () => fixtureSnapshot(),
        worker: {
          ensure: async () => {
            ensureCalls += 1;
            return { id: "unused", key: "unused", phase: "preparing" };
          },
        } as never,
      },
    );
    expect(Object.keys(hooks)).toEqual(["agent_settled"]);
    await hooks.agent_settled({ hardPath: true });
    await hooks.agent_settled({ reason: "overflow" });
    expect(ensureCalls).toBe(0);
    await hooks.agent_settled({});
    expect(ensureCalls).toBe(1);
    await fx.shutdown();
    expect(fx.publishCount()).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { generationFixture } from "./support.js";

describe("generation fencing", () => {
  it("loses CAS when a newer user directive advances the head", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    await fx.appendDirective();
    const result = await fx.publish(prepared);
    expect(result).toMatchObject({ kind: "stale", reason: "head-changed" });
    expect(fx.materialized()).toEqual([]);
  });

  it("stales when config reducer schema or model fence changes", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    fx.changeFence({ modelKey: "model-b", schemaVersion: "2", reducerRevisionSet: "red-2", configFingerprint: "cfg-2" });
    const result = await fx.publish(prepared);
    expect(result).toMatchObject({ kind: "stale", reason: "fence-changed" });
  });

  it("is idempotent on duplicate publish of a committed generation", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    const first = await fx.publish(prepared);
    const second = await fx.publish(prepared);
    expect(first.kind).toBe("committed");
    expect(second).toMatchObject({ kind: "committed", receipt: first.receipt });
    expect(fx.materialized()).toEqual([prepared.generationId]);
  });

  it("recovers a crash after generation insert and before head CAS", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    fx.crashBeforeCas();
    await expect(fx.publish(prepared)).rejects.toThrow(/crash-after-insert/);
    expect(fx.generationState(prepared.generationId)).toBe("prepared");
    expect(fx.materialized()).toEqual([]);
    const recovered = await fx.recover(prepared.generationId);
    expect(recovered).toMatchObject({ kind: "stale", reason: "half-published" });
    expect(fx.generationState(prepared.generationId)).toBe("stale");
  });

  it("does not wait or materialize on the overflow path", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    const result = await fx.publish({ ...prepared, overflow: true });
    expect(result).toMatchObject({ kind: "rejected", reason: "overflow-no-wait" });
    expect(fx.materialized()).toEqual([]);
  });

  it("materializes only committed generations", async () => {
    const fx = generationFixture();
    const ok = await fx.prepare();
    const stale = await fx.prepare();
    await fx.appendDirective();
    await fx.publish(stale);
    const committed = await fx.publish({ ...ok, expectedHeadHash: "head_0" });
    expect(committed.kind).toBe("stale");
    const fresh = await fx.prepare();
    const published = await fx.publish(fresh);
    expect(published.kind).toBe("committed");
    expect(fx.materialized()).toEqual([fresh.generationId]);
  });
});

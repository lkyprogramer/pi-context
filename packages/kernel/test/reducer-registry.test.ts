import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../contracts/src/index.js";
import { ReducerRegistry } from "../src/reducers/registry.js";

describe("ReducerRegistry", () => {
  it("routes by explicit tool matcher and records immutable revision", async () => {
    const registry = new ReducerRegistry();
    registry.register({
      id: "bash",
      revision: "1",
      matches: (x) => x.toolName === "bash",
      reduce: async () => ({ visibleText: "ok", facts: [] }),
    });
    const result = await registry.reduce({ toolName: "bash" } as never);
    expect(result.reducer).toEqual({ id: "bash", revision: "1" });
  });

  it("rejects a duplicate reducer ID", () => {
    const registry = new ReducerRegistry();
    registry.register({
      id: "bash",
      revision: "1",
      matches: () => true,
      reduce: async () => ({ visibleText: "ok", facts: [] }),
    });
    expect(() =>
      registry.register({
        id: "bash",
        revision: "2",
        matches: () => true,
        reduce: async () => ({ visibleText: "ok", facts: [] }),
      }),
    ).toThrow(/duplicate reducer:bash/);
  });

  it("falls back to a pointer when size or timeout limits are exceeded", async () => {
    const registry = new ReducerRegistry();
    registry.register({
      id: "slow",
      revision: "1",
      matches: (x) => x.toolName === "slow",
      reduce: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { visibleText: "late", facts: [] };
      },
    });
    const timedOut = await registry.reduce({
      toolName: "slow",
      rawBlobId: "blob_timeout",
      sourceContentHash: "aa",
      sourceClass: "trusted-tool",
    });
    expect(timedOut.fallback).toBe(true);
    expect(timedOut.visibleText).toContain("ctx://observation/blob_timeout");

    const oversized = await registry.reduce({
      toolName: "slow",
      rawBlobId: "blob_big",
      bytes: 99 * 1024 * 1024,
      sourceContentHash: "bb",
      sourceClass: "trusted-tool",
    });
    expect(oversized.fallback).toBe(true);
  });

  it("does not let a reducer change raw blob, hash, or source class", async () => {
    const registry = new ReducerRegistry();
    registry.register({
      id: "evil",
      revision: "1",
      matches: () => true,
      reduce: async () =>
        ({
          visibleText: "ok",
          facts: [],
          rawBlobId: "blob_forged",
          sourceContentHash: "forged",
          sourceClass: "authenticated-user",
        }) as never,
    });
    const result = await registry.reduce({
      toolName: "bash",
      rawBlobId: "blob_real",
      sourceContentHash: "abc",
      sourceClass: "trusted-tool",
    });
    expect(result.rawBlobId).toBe("blob_real");
    expect(result.sourceContentHash).toBe("abc");
    expect(result.sourceClass).toBe("trusted-tool");
  });

  it("produces the same canonical output for the same input and revision", async () => {
    const registry = new ReducerRegistry();
    registry.register({
      id: "bash",
      revision: "1",
      matches: (x) => x.toolName === "bash",
      reduce: async () => ({ visibleText: "ok", facts: [{ k: 1 }] }),
    });
    const input = { toolName: "bash", rawBlobId: "blob_a", sourceContentHash: "hh", sourceClass: "trusted-tool" };
    const a = await registry.reduce(input);
    const b = await registry.reduce(input);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(registry.fingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });
});

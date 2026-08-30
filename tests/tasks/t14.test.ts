import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createProductionReducers,
  createReducerRegistry,
  type ReducerInput,
  type ToolObservation,
} from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t14",
    sessionId: "session-t14",
    leafId: "leaf-t14",
    lineageEntryIds: ["root", "leaf-t14"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function observation(overrides: Partial<ToolObservation> = {}): ToolObservation {
  const bound = cursor();
  const { cursor: nextCursor, ...rest } = overrides;
  return {
    operationId: "op-t14",
    toolCallId: "call-t14",
    toolName: "bash",
    args: { command: "npm test" },
    content: [{ type: "text", text: "error: boom\nexit code 1" }],
    details: { exitCode: 1 },
    isError: true,
    capturedAt: 14,
    sourceClass: "untrusted-tool",
    authority: "inform",
    ...rest,
    cursor: nextCursor ?? bound,
  };
}

function input(observationInput: ToolObservation = observation()): ReducerInput {
  const text = observationInput.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    observation: observationInput,
    text,
    rawBlobId: "blob_" + "a".repeat(64),
    cursor: observationInput.cursor,
    signal: observationInput.signal,
  };
}

async function runT14Fixture(): Promise<{ ok: true; task: "T14" }> {
  const bound = cursor();
  const registry = createReducerRegistry({
    cursor: bound,
    reducers: createProductionReducers(),
  });
  const first = await registry.reduce(input(observation({ cursor: bound })));
  const second = await registry.reduce(input(observation({ cursor: bound })));
  expect(first.reducer.id).toBe("bash");
  expect(first.visibleText).toContain("[bash-result");
  expect(first.visibleText).toContain("error: boom");
  expect(first.visibleText).toContain("ctx://observation/blob_");
  expect(first.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "exit-code", value: 1 }),
  ]));
  expect(second).toEqual(first);
  return { ok: true, task: "T14" };
}

describe("T14 Reducer registry and production reducers", () => {
  it("reducer_registry_and_production_reducers", async () => {
    await expect(runT14Fixture()).resolves.toEqual({ ok: true, task: "T14" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createReducerRegistry({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_REDUCER_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed input before reduce", async () => {
    const bound = cursor();
    const registry = createReducerRegistry({
      cursor: bound,
      reducers: createProductionReducers(),
    });
    await expect(registry.reduce({} as never)).rejects.toThrow(/PCR_REDUCER_INPUT_INVALID/);
  });

  it("rejects a tool observation from the wrong workspace/session/branch", async () => {
    const bound = cursor();
    const registry = createReducerRegistry({
      cursor: bound,
      reducers: createProductionReducers(),
    });
    const other = observation({
      cursor: { ...bound, sessionId: "other-session" },
    });
    await expect(registry.reduce(input(other))).rejects.toThrow(/PCR_REDUCER_SCOPE_MISMATCH/);
  });

  it("stops at the abort boundary before invoking a reducer", async () => {
    const bound = cursor();
    let calls = 0;
    const registry = createReducerRegistry({
      cursor: bound,
      reducers: [{
        id: "probe",
        supports: () => true,
        async reduce() {
          calls += 1;
          return { visibleText: "should-not-run", facts: [] };
        },
      }],
    });
    const controller = new AbortController();
    controller.abort();
    await expect(registry.reduce(input(observation({ cursor: bound, signal: controller.signal })))).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("is deterministic across two independent registries", async () => {
    const bound = cursor();
    const left = createReducerRegistry({ cursor: bound, reducers: createProductionReducers() });
    const right = createReducerRegistry({ cursor: bound, reducers: createProductionReducers() });
    const payload = input(observation({ cursor: bound }));
    expect(await left.reduce(payload)).toEqual(await right.reduce(payload));
  });
});

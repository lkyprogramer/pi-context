import { describe, expect, it } from "vitest";

import type { HostMessage } from "@pcr/contracts";
import {
  createCacheReceipt,
  createMaterializer,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
  type CacheReceiptStore,
  type MaterializationRequest,
  type RuntimeSnapshot,
} from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t27",
    sessionId: "session-t27",
    leafId: "leaf-t27",
    lineageEntryIds: ["root", "leaf-t27"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

const ROUTE = {
  modelKey: "openclaw/Qwen3.8-27B-WORK",
  contextWindow: 4096,
  maxOutputTokens: 256,
  providerReservedTokens: 0,
} as const;

function userMessage(text: string, hostMessageId = "user-t27"): HostMessage {
  return {
    hostMessageId,
    role: "user",
    timestamp: 27,
    sourceClass: "authenticated-user",
    content: [{ type: "text", text }],
  };
}

function snapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  const bound = cursor();
  return {
    cursor: bound,
    directives: [userMessage("do not deploy production", "dir-t27")],
    continuity: [userMessage("active: write docs", "cont-t27")],
    ...overrides,
  };
}

function requestWith(message: HostMessage, extras: Partial<MaterializationRequest> = {}): MaterializationRequest {
  return {
    cursor: cursor(),
    canonicalMessages: [message],
    currentContextWindow: ROUTE.contextWindow,
    maxOutputTokens: ROUTE.maxOutputTokens,
    reason: "normal",
    now: 27,
    ...extras,
  };
}

function memoryStore(): CacheReceiptStore {
  const rows: CacheReceiptRecord[] = [];
  return {
    async put(receipt) {
      rows.push(receipt);
    },
    async head(scope) {
      return [...rows].reverse().find((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
  };
}

function materializer() {
  const bound = cursor();
  const pricer = createTokenPricer({ cursor: bound, routes: { [ROUTE.modelKey]: ROUTE } });
  return createMaterializer({
    cursor: bound,
    pricer,
    planner: createSectionPlanner({ cursor: bound, pricer }),
    cache: createCacheReceipt({ cursor: bound, store: memoryStore() }),
  });
}

async function runT27Fixture() {
  const gate = materializer();
  const small = userMessage("fix the parser");
  const view = await gate.materialize(requestWith(small), snapshot());
  expect(view.messages.some((item) => item.content.some((block) => block.type === "text" && block.text === "do not deploy production"))).toBe(true);
  expect(view.messages.some((item) => item.content.some((block) => block.type === "text" && block.text === "keep"))).toBe(false);
  expect(view.sections.find((item) => item.kind === "hard-directives")?.estimatedTokens).toBeGreaterThan(0);
  expect(view.sections.find((item) => item.kind === "active-turn")?.messageIds).toEqual([small.hostMessageId]);
  expect(view.cachePlan.firstDifferentSection).toBe("runtime-preamble");
  const replayed = await gate.materialize(requestWith(small), snapshot());
  expect(replayed.outputHash).toBe(view.outputHash);
  expect(replayed.messages).toEqual(view.messages);
  expect(replayed.cachePlan.previousViewId).toBe(view.viewId);
  return { ok: true as const, task: "T27" as const, view };
}

describe("T27 Budget-correct materializer", () => {
  it("prices the exact active turn content, not message ids", async () => {
    const huge = userMessage("x".repeat(200_000));
    await expect(materializer().materialize(requestWith(huge), snapshot())).rejects.toMatchObject({
      code: "PCR_UNREPAIRABLE_ACTIVE_TURN",
    });
  });

  it("budget_correct_materializer", async () => {
    await expect(runT27Fixture()).resolves.toMatchObject({ ok: true, task: "T27" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createMaterializer({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_MATERIALIZER_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed requests and empty snapshots", async () => {
    const gate = materializer();
    await expect(gate.materialize({} as never, snapshot())).rejects.toThrow(/PCR_MATERIALIZER_INPUT_INVALID/);
    await expect(gate.materialize(requestWith(userMessage("ok")), {} as never)).rejects.toThrow(/PCR_MATERIALIZER_INPUT_INVALID/);
  });

  it("replays the same request to an equal view hash", async () => {
    const gate = materializer();
    const first = await gate.materialize(requestWith(userMessage("ok")), snapshot());
    const second = await gate.materialize(requestWith(userMessage("ok")), snapshot());
    expect(second.outputHash).toBe(first.outputHash);
    expect(second.messages).toEqual(first.messages);
  });

  it("rejects a cursor from another workspace/session/branch", async () => {
    const gate = materializer();
    const other = { ...cursor(), sessionId: "other-session" };
    await expect(gate.materialize(requestWith(userMessage("ok"), { cursor: other }), snapshot())).rejects.toThrow(
      /PCR_MATERIALIZER_SCOPE_MISMATCH/,
    );
    await expect(gate.materialize(requestWith(userMessage("ok")), snapshot({ cursor: other }))).rejects.toThrow(
      /PCR_MATERIALIZER_SCOPE_MISMATCH/,
    );
  });

  it("does not treat a shared message id as a cheap active turn", async () => {
    const gate = materializer();
    const cheap = await gate.materialize(requestWith(userMessage("x", "shared-id")), snapshot());
    await expect(gate.materialize(requestWith(userMessage("x".repeat(200_000), "shared-id")), snapshot())).rejects.toMatchObject({
      code: "PCR_UNREPAIRABLE_ACTIVE_TURN",
    });
    expect(cheap.sections.find((item) => item.kind === "active-turn")?.estimatedTokens).toBeLessThan(100);
  });

  it("stops at the abort boundary before planning", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(materializer().materialize(
      requestWith(userMessage("ok"), { signal: controller.signal }),
      snapshot(),
    )).rejects.toThrow();
  });
});

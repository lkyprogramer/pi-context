import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import {
  createRecoveryService,
  createRuntimeSessionRegistry,
  planSagaRecovery,
  type HostSnapshot,
  type PiSessionContext,
  type RuntimeSession,
  type SagaRecord,
} from "@pcr/runtime";

afterEach(resetOwnerForTest);

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

function cursor(leafId = "leaf-t32") {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t32",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function memorySessions(bound = cursor()) {
  const openIds: string[] = [];
  const closed: string[] = [];
  const registry = createRuntimeSessionRegistry({
    workspaceId: bound.workspaceId,
    factory: {
      async create(ctx: PiSessionContext) {
        const session: RuntimeSession = {
          async ingestUserInput() { throw new Error("unused"); },
          async ingestToolResult() { throw new Error("unused"); },
          async materialize() { throw new Error("unused"); },
        };
        openIds.push(ctx.sessionId);
        return {
          session,
          async dispose() { closed.push(ctx.sessionId); },
        };
      },
    },
  });
  return { registry, openIds, closed };
}

function memoryJournal(records: SagaRecord[]) {
  return {
    async reconcile(snapshot: HostSnapshot) {
      const plan = planSagaRecovery(records, snapshot);
      for (const transition of plan.transitions) {
        const row = records.find((item) => item.operationId === transition.operationId);
        if (!row) continue;
        row.state = transition.state;
        if (transition.hostId) row.hostId = transition.hostId;
      }
      return { actions: plan.actions };
    },
  };
}

function memoryFence() {
  const keys = new Set<string>();
  const reasons: string[] = [];
  return {
    reasons,
    async invalidate(scope: { sessionId: string; lineageHash: string }, reason: string) {
      reasons.push(reason);
      const key = `${scope.sessionId}:${scope.lineageHash}:${reason}`;
      if (keys.has(key)) return 0;
      keys.add(key);
      return 1;
    },
  };
}

async function runT32Fixture() {
  const bound = cursor();
  const record: SagaRecord = {
    operationId: "operation-t32",
    cursor: bound,
    kind: "tool-result",
    sourceContentHash: domainHash("t32-source", "bytes"),
    hostCorrelationId: "tool-call-t32",
    rawBlobId: blobId(`blob_${domainHash("t32-blob", "bytes")}`),
    configFingerprint: domainHash("t32-config", { k: 1 }),
    state: "host_visible",
    hostId: "host-entry-t32",
    revision: 1,
  };
  const snapshot: HostSnapshot = {
    cursor: bound,
    configFingerprint: record.configFingerprint,
    entries: [{
      hostId: "host-entry-t32",
      hostCorrelationId: record.hostCorrelationId,
      contentHash: record.sourceContentHash,
    }],
  };
  const sessions = memorySessions(bound);
  const fence = memoryFence();
  const service = createRecoveryService({
    cursor: bound,
    sessions: sessions.registry,
    journal: memoryJournal([record]),
    candidates: fence,
  });
  const first = await service.onSessionStart({
    cursor: bound,
    reason: "resume",
    hasRawBlobs: true,
    hostSnapshot: snapshot,
  });
  expect(first.cursor.workspaceId).toBe(bound.workspaceId);
  expect(first.cursor.workspaceId).not.toMatch(/^ws_0+$/u);
  expect(first.cursor.sessionId).toBe("session-t32");
  expect(first.catchUp).toMatchObject({ reason: "resume", pointerUnavailable: false, degraded: false });
  expect(first.saga.actions).toContainEqual(expect.objectContaining({
    operationId: "operation-t32",
    to: "committed",
    reason: "host-visibility-recovered",
  }));
  const replayed = await service.onSessionStart({
    cursor: bound,
    reason: "resume",
    hasRawBlobs: true,
    hostSnapshot: snapshot,
  });
  expect(replayed.cursor).toEqual(first.cursor);
  expect(replayed.catchUp).toEqual(first.catchUp);
  const next = cursor("leaf-t32-b");
  await service.onBranchChange({ cursor: next, previousCursor: bound, newLeafId: "leaf-t32-b" });
  expect(sessions.closed).toContain(bound.sessionId);
  expect(fence.reasons.some((item) => item.includes("branch-change"))).toBe(true);
  return { ok: true as const, task: "T32" as const, report: first };
}

describe("T32 Session, branch and restart recovery", () => {
  it("session_branch_and_restart_recovery", async () => {
    await expect(runT32Fixture()).resolves.toMatchObject({ ok: true, task: "T32" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createRecoveryService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RECOVERY_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed session start input", async () => {
    const bound = cursor();
    const service = createRecoveryService({
      cursor: bound,
      sessions: memorySessions(bound).registry,
      journal: memoryJournal([]),
      candidates: memoryFence(),
    });
    await expect(service.onSessionStart({} as never)).rejects.toMatchObject({ code: "PCR_RECOVERY_INPUT_INVALID" });
    await expect(service.onSessionStart({
      cursor: bound,
      reason: "startup" as never,
      hasRawBlobs: true,
    })).rejects.toMatchObject({ code: "PCR_RECOVERY_INPUT_INVALID" });
  });

  it("replays catch-up for the same resume", async () => {
    const bound = cursor();
    const service = createRecoveryService({
      cursor: bound,
      sessions: memorySessions(bound).registry,
      journal: memoryJournal([]),
      candidates: memoryFence(),
    });
    const input = { cursor: bound, reason: "reload" as const, hasRawBlobs: false };
    const first = await service.onSessionStart(input);
    const second = await service.onSessionStart(input);
    expect(second.catchUp).toEqual(first.catchUp);
    expect(second.catchUp).toMatchObject({ reason: "reload", pointerUnavailable: true, degraded: true });
  });

  it("rejects a cursor from another workspace", async () => {
    const bound = cursor();
    const service = createRecoveryService({
      cursor: bound,
      sessions: memorySessions(bound).registry,
      journal: memoryJournal([]),
      candidates: memoryFence(),
    });
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t32",
      leafId: "leaf-t32",
      lineageEntryIds: ["root", "leaf-t32"],
      modelKey: bound.modelKey,
    });
    await expect(service.onSessionStart({ cursor: other, reason: "new", hasRawBlobs: true })).rejects.toMatchObject({
      code: "PCR_RECOVERY_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before opening a session", async () => {
    const bound = cursor();
    let opened = 0;
    const service = createRecoveryService({
      cursor: bound,
      sessions: {
        async open() { opened += 1; throw new Error("should not open"); },
        async close() {},
      },
      journal: { async reconcile() { throw new Error("should not reconcile"); } },
      candidates: { async invalidate() { return 0; } },
    });
    await expect(service.onSessionStart({
      cursor: bound,
      reason: "new",
      hasRawBlobs: true,
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(opened).toBe(0);
  });

  it("product lifecycle maps Pi startup to a derived cursor instead of ws_012/s1/leaf-a", async () => {
    const hooks: Record<string, (event: unknown, ctx: unknown) => Promise<unknown>> = {};
    const ext = createPiContextExtension({
      on(hook, next) { hooks[hook] = next as typeof hooks[string]; },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    const manager = SessionManager.inMemory(`${WORK}-product`);
    manager.appendMessage({ role: "user", content: "startup branch" } as never);
    const ctx = {
      cwd: manager.getCwd(),
      sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK" },
      sessionId: manager.getSessionId(),
    };
    const recovered = await hooks.session_start?.({ type: "session_start", reason: "startup" }, ctx) as {
      workspaceId: string;
      sessionId: string;
      leafId: string | null;
      lineageHash: string;
      modelKey: string;
    };
    expect(recovered.workspaceId).toMatch(/^ws_[a-f0-9]{40}$/u);
    expect(recovered.sessionId).toBe(manager.getSessionId());
    expect(recovered.leafId).toBe(manager.getLeafId());
    expect(recovered.sessionId).not.toBe("s1");
    expect(recovered.sessionId).not.toBe("unbound");
    expect(recovered.leafId).not.toBe("leaf-a");
    expect(recovered.modelKey).toBe("openclaw/Qwen3.8-27B-WORK");
    await hooks.session_tree?.({ type: "session_tree", newLeafId: manager.getLeafId() }, ctx);
    await hooks.session_shutdown?.({ type: "session_shutdown" }, ctx);
    await ext.release?.();
  });
});

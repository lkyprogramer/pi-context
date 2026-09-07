import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createProductionCompositionRoot,
  derivePiSessionContext,
  registerProductionUserTurnRuntime,
  type PiRuntimeContext,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";
import { blobId, domainHash } from "@pcr/contracts";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function resources(): ProductionSessionResourcesFactory {
  return {
    async create(ctx) {
      return {
        ports: {
          userInput: {
            async capture(input) {
              return {
                operationId: input.operationId,
                receiptId: `receipt-${ctx.sessionId}-${input.operationId}`,
                status: "pending" as const,
                cursor: input.cursor,
                rawTextHash: "a".repeat(64),
                rawBlobId: blobId(`blob_${domainHash("conc", ctx.sessionId)}`),
                utf8Bytes: 1,
                sourceClass: input.sourceClass,
                capturedAt: input.capturedAt,
              };
            },
          },
          toolResult: {
            async ingest(input) {
              return {
                operationId: input.operationId,
                observationId: `obs-${ctx.sessionId}`,
                rawBlobId: blobId(`blob_${domainHash("conc", ctx.sessionId)}`),
                evidenceIds: [],
                visibleContent: input.content,
                isError: input.isError,
                reducer: { id: "conc", revision: "1" },
              };
            },
          },
          materialization: {
            async materialize() {
              return { messages: [], tokenCost: 0, cache: { eligiblePrefixTokens: 0 } } as never;
            },
          },
        },
        async dispose() {},
      };
    },
  };
}

function host(manager: SessionManager, modelId = "Qwen3.8-27B-WORK"): PiRuntimeContext {
  return {
    cwd: manager.getCwd(),
    sessionManager: manager,
    model: {
      provider: "openclaw",
      id: modelId,
      contextWindow: 200_192,
      maxTokens: 16_384,
    } as PiRuntimeContext["model"],
  };
}

describe("runtime concurrency gate", () => {
  it("opens concurrent sessions without cross-scope capture", async () => {
    const root = createProductionCompositionRoot({
      identity: { create: createRuntimeCursor },
      resources: resources(),
    });
    const managers = Array.from({ length: 4 }, (_, workspace) => (
      Array.from({ length: 4 }, () => SessionManager.inMemory(`/tmp/pcr-conc-${workspace}`))
    ));
    const sessions = await Promise.all(managers.flatMap((group, workspace) => (
      group.map((manager) => root.open(host(manager, `m-${workspace}`)))
    )));
    expect(new Set(sessions).size).toBe(sessions.length);
    await Promise.all(sessions.map((session, index) => session.ingestUserInput({
      operationId: `op-${index}`,
      cursor: session.scope as never,
      rawText: `workspace-${index}`,
      sourceClass: "authenticated-user",
      capturedAt: index,
    })));
    for (const manager of managers.flat()) {
      manager.appendMessage({ role: "user", content: "branch-leaf" } as never);
    }
    const branched = await Promise.all(managers.flatMap((group, workspace) => (
      group.map((manager) => root.open(host(manager, `m-${workspace}`)))
    )));
    expect(new Set([...sessions, ...branched]).size).toBe(sessions.length + branched.length);
    await Promise.all(branched.map((session, index) => session.ingestUserInput({
      operationId: `op-branch-${index}`,
      cursor: session.scope as never,
      rawText: `branch-${index}`,
      sourceClass: "authenticated-user",
      capturedAt: index,
    })));
    await Promise.all(managers.flat().map((manager) => root.close(host(manager))));
  });

  it("runs production sqlite sessions across workspaces without cross-scope capture", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-conc-prod-"));
    roots.push(root);
    const runtime = registerProductionUserTurnRuntime({
      on() {},
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    } as never, { dataRoot: () => root });
    const identity = { create: createRuntimeCursor };
    const managers = Array.from({ length: 2 }, (_, workspace) => (
      Array.from({ length: 2 }, (_, session) => SessionManager.inMemory(join(root, `w${workspace}-s${session}`)))
    ));
    const sessions = [];
    for (const [workspace, group] of managers.entries()) {
      for (const manager of group) {
        const ctx = host(manager, `m-${workspace}`);
        await runtime.ensure(ctx as never);
        sessions.push(await runtime.openSession(derivePiSessionContext(ctx, identity)));
      }
    }
    expect(new Set(sessions.map((session) => session.scope.sessionId)).size).toBe(sessions.length);
    await Promise.all(sessions.map((session, index) => {
      const ctx = host(managers.flat()[index]!, `m-${Math.floor(index / 2)}`);
      return session.ingestUserInput({
        operationId: `op-${index}`,
        cursor: derivePiSessionContext(ctx, identity),
        rawText: `workspace-${index}`,
        sourceClass: "authenticated-user",
        capturedAt: index,
      });
    }));
    await runtime.close();
  });
});

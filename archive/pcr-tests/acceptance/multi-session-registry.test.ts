import { SessionManager } from "@earendil-works/pi-coding-agent";
import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProductionCompositionRoot,
  type PiRuntimeContext,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

afterEach(resetOwnerForTest);

function resources(log: string[]): ProductionSessionResourcesFactory {
  return {
    async create(ctx) {
      log.push(`${ctx.workspaceId}:${ctx.sessionId}:${ctx.modelKey}:${ctx.lineageHash}`);
      return {
        ports: {
          userInput: {
            async capture(input) {
              return {
                operationId: input.operationId,
                receiptId: `receipt-${ctx.sessionId}`,
                status: "pending" as const,
                cursor: input.cursor,
                rawTextHash: "a".repeat(64),
                rawBlobId: blobId(`blob_${domainHash("multi-session", ctx.sessionId)}`),
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
                rawBlobId: blobId(`blob_${domainHash("multi-session", ctx.sessionId)}`),
                evidenceIds: [],
                visibleContent: input.content,
                isError: input.isError,
                reducer: { id: "multi-session", revision: "1" },
              };
            },
          },
          materialization: {
            async materialize() {
              throw new Error("unused");
            },
          },
        },
        async dispose() {
          log.push(`dispose:${ctx.sessionId}:${ctx.modelKey}`);
        },
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

describe("cursor-scoped session registry", () => {
  it("keeps two sessions in one workspace and two workspaces isolated, and switches model/branch", async () => {
    const firstManager = SessionManager.inMemory("/tmp/pcr-multi-a");
    const secondManager = SessionManager.inMemory("/tmp/pcr-multi-a");
    const otherWorkspace = SessionManager.inMemory("/tmp/pcr-multi-b");
    const log: string[] = [];
    const root = createProductionCompositionRoot({
      identity: { create: createRuntimeCursor },
      resources: resources(log),
    });

    const sessionA = await root.open(host(firstManager));
    const sessionB = await root.open(host(secondManager));
    expect(sessionB).not.toBe(sessionA);
    expect(root.get(firstManager.getSessionId())).toBe(sessionA);
    expect(root.get(secondManager.getSessionId())).toBe(sessionB);

    const other = await root.open(host(otherWorkspace));
    expect(other).not.toBe(sessionA);

    const switched = await root.open(host(firstManager, "other-model"));
    expect(switched).not.toBe(sessionA);
    expect(log.some((row) => row.startsWith(`dispose:${firstManager.getSessionId()}:openclaw/Qwen3.8-27B-WORK`))).toBe(true);

    firstManager.appendMessage({ role: "user", content: "branch" } as never);
    const branched = await root.open(host(firstManager, "other-model"));
    expect(branched).not.toBe(switched);
  });

  it("does not keep a single lastRecoveredCursor fallback in the default extension", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("apps/pi-context-runtime/src/extension.ts", "utf8");
    expect(source).not.toMatch(/lastRecoveredCursor/);
    expect(source).toMatch(/cursorsBySession/);
    expect(source).toMatch(/PCR_LIFECYCLE_PREVIOUS_CURSOR_MISSING/);
  });
});

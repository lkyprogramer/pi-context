import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createProductionCompositionRoot,
  type PiRuntimeContext,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";
import { blobId, domainHash } from "@pcr/contracts";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

afterEach(resetOwnerForTest);

function resources(kills: number[]): ProductionSessionResourcesFactory {
  let calls = 0;
  return {
    async create(ctx) {
      return {
        ports: {
          userInput: {
            async capture(input) {
              calls += 1;
              if (kills.includes(calls)) {
                throw Object.assign(new Error("killed"), { code: "PCR_RUNTIME_KILLED" });
              }
              return {
                operationId: input.operationId,
                receiptId: `receipt-${ctx.sessionId}`,
                status: "pending" as const,
                cursor: input.cursor,
                rawTextHash: "a".repeat(64),
                rawBlobId: blobId(`blob_${domainHash("fault-conc", ctx.sessionId)}`),
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
                rawBlobId: blobId(`blob_${domainHash("fault-conc", ctx.sessionId)}`),
                evidenceIds: [],
                visibleContent: input.content,
                isError: input.isError,
                reducer: { id: "fault-conc", revision: "1" },
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

function host(manager: SessionManager): PiRuntimeContext {
  return {
    cwd: manager.getCwd(),
    sessionManager: manager,
    model: {
      provider: "openclaw",
      id: "Qwen3.8-27B-WORK",
      contextWindow: 200_192,
      maxTokens: 16_384,
    } as PiRuntimeContext["model"],
  };
}

describe("runtime concurrency faults", () => {
  it("keeps sibling sessions usable after a killed capture", async () => {
    const root = createProductionCompositionRoot({
      identity: { create: createRuntimeCursor },
      resources: resources([1]),
    });
    const first = SessionManager.inMemory("/tmp/pcr-fault-a");
    const second = SessionManager.inMemory("/tmp/pcr-fault-a");
    const sessionA = await root.open(host(first));
    const sessionB = await root.open(host(second));
    await expect(sessionA.ingestUserInput({
      operationId: "op-kill",
      cursor: sessionA.scope as never,
      rawText: "kill",
      sourceClass: "authenticated-user",
      capturedAt: 1,
    })).rejects.toMatchObject({ code: "PCR_RUNTIME_KILLED" });
    await expect(sessionB.ingestUserInput({
      operationId: "op-ok",
      cursor: sessionB.scope as never,
      rawText: "ok",
      sourceClass: "authenticated-user",
      capturedAt: 2,
    })).resolves.toMatchObject({ operationId: "op-ok" });
  });
});

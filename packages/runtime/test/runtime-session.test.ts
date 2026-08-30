import { describe, expect, it } from "vitest";

import {
  RuntimeSessionApplicationService,
  RuntimeSessionError,
  createRuntimeSession,
  type RuntimeSessionPorts,
} from "@pcr/runtime";

const cursor = {
  workspaceId: "ws-public",
  sessionId: "session-public",
  leafId: "leaf-public",
  lineageHash: "a".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

function publicPorts(): RuntimeSessionPorts {
  return {
    userInput: {
      async capture(input) {
        return {
          operationId: input.operationId,
          userTurnId: "turn-public",
          cursor: input.cursor,
          rawTextHash: "hash-public",
          rawBlobId: "blob-public",
          utf8Bytes: Buffer.byteLength(input.rawText, "utf8"),
          sourceClass: input.sourceClass,
          capturedAt: input.capturedAt,
        };
      },
    },
    toolResult: {
      async ingest(input) {
        return {
          operationId: input.operationId,
          observationId: "observation-public",
          rawBlobId: "blob-public",
          evidenceIds: ["evidence-public"],
          visibleContent: input.content,
          isError: input.isError,
          reducer: { id: "public", revision: "1" },
        };
      },
    },
    materialization: {
      async materialize(input) {
        return {
          viewId: "view-public",
          outputHash: "output-public",
          messages: [...input.canonicalMessages],
          sections: [],
          tokenEstimate: 0,
          cachePlan: {
            layoutVersion: 1,
            sectionOrder: [],
            eligiblePrefixTokens: 0,
            firstDifferentSection: null,
            previousViewId: null,
            providerCapability: "unknown",
          },
          omissions: [],
        };
      },
    },
  };
}

describe("RuntimeSession public package contract", () => {
  it("exports the application service and factory from @pcr/runtime", () => {
    const session = createRuntimeSession({
      scope: {
        workspaceId: cursor.workspaceId,
        sessionId: cursor.sessionId,
        leafId: cursor.leafId,
        lineageHash: cursor.lineageHash,
      },
      ports: publicPorts(),
    });

    expect(session).toBeInstanceOf(RuntimeSessionApplicationService);
    expect(session.scope).toEqual({
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      leafId: cursor.leafId,
      lineageHash: cursor.lineageHash,
    });
  });

  it("rejects a non-SHA-256 lineage scope", () => {
    expect(() =>
      createRuntimeSession({
        scope: { workspaceId: "ws", sessionId: "session", leafId: null, lineageHash: "not-a-hash" },
        ports: publicPorts(),
      }),
    ).toThrowError(RuntimeSessionError);
  });
});

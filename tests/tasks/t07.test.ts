import { describe, expect, it } from "vitest";

import { createRuntimeSession } from "../../packages/runtime/src/runtime-session.js";
import type {
  MaterializationPort,
  RuntimeSessionPorts,
  ToolResultPort,
  UserInputEvent,
  UserInputPort,
} from "../../packages/runtime/src/ports.js";

const cursor = {
  workspaceId: "ws-t07",
  sessionId: "session-t07",
  leafId: "leaf-t07",
  lineageHash: "7".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

function userInput(operationId: string, rawText = "preserve exact user input"): UserInputEvent {
  return {
    operationId,
    cursor,
    rawText,
    sourceClass: "authenticated-user",
    capturedAt: 1_700_000_000_000,
  };
}

function createPorts(
  overrides: Partial<{
    userInput: UserInputPort;
    toolResult: ToolResultPort;
    materialization: MaterializationPort;
  }> = {},
): RuntimeSessionPorts {
  return {
    userInput:
      overrides.userInput ??
      ({
        async capture(input) {
          return {
            operationId: input.operationId,
            userTurnId: `turn-${input.operationId}`,
            cursor: input.cursor,
            rawTextHash: `hash-${input.rawText}`,
            rawBlobId: `blob-${input.operationId}`,
            utf8Bytes: Buffer.byteLength(input.rawText, "utf8"),
            sourceClass: input.sourceClass,
            capturedAt: input.capturedAt,
          };
        },
      } satisfies UserInputPort),
    toolResult:
      overrides.toolResult ??
      ({
        async ingest(input) {
          return {
            operationId: input.operationId,
            observationId: `observation-${input.operationId}`,
            rawBlobId: `blob-${input.operationId}`,
            evidenceIds: [`evidence-${input.operationId}`],
            visibleContent: input.content,
            isError: input.isError,
            reducer: { id: "identity", revision: "1" },
          };
        },
      } satisfies ToolResultPort),
    materialization:
      overrides.materialization ??
      ({
        async materialize(input) {
          return {
            viewId: `view-${input.operationId}`,
            outputHash: `output-${input.operationId}`,
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
      } satisfies MaterializationPort),
  };
}

function createSession(ports = createPorts()) {
  return createRuntimeSession({
    scope: {
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      leafId: cursor.leafId,
      lineageHash: cursor.lineageHash,
    },
    ports,
  });
}

describe("T07 Runtime ports and RuntimeSession application service", () => {
  it("runtime_ports_and_runtimesession_application_ser", async () => {
    const session = createSession();
    const receipt = await session.ingestUserInput(userInput("op-t07-user"));

    expect(receipt).toMatchObject({ operationId: "op-t07-user", userTurnId: "turn-op-t07-user" });
  });

  it("delegates tool projection and materialization without rewriting source, authority, or payload", async () => {
    let seenTool: unknown;
    let seenMaterialization: unknown;
    const session = createSession(
      createPorts({
        toolResult: {
          async ingest(input) {
            seenTool = input;
            return {
              operationId: input.operationId,
              observationId: "observation-tool",
              rawBlobId: "blob-tool",
              evidenceIds: ["evidence-tool"],
              visibleContent: input.content,
              isError: input.isError,
              reducer: { id: "shell", revision: "1" },
            };
          },
        },
        materialization: {
          async materialize(input) {
            seenMaterialization = input;
            return createPorts().materialization.materialize(input);
          },
        },
      }),
    );
    const tool = {
      operationId: "op-tool",
      cursor,
      toolCallId: "call-tool",
      toolName: "read",
      args: { path: "/workspace/file.txt" },
      content: [{ type: "text" as const, text: "exact output" }],
      details: { exitCode: 0 },
      isError: false,
      capturedAt: 1_700_000_000_001,
      sourceClass: "trusted-tool" as const,
      authority: "act" as const,
    };
    const materialization = {
      operationId: "op-view",
      cursor,
      canonicalMessages: [],
      currentContextWindow: 200192,
      maxOutputTokens: 16384,
      reason: "normal" as const,
      now: 1_700_000_000_002,
    };

    const projected = await session.ingestToolResult(tool);
    const view = await session.materialize(materialization);

    expect(seenTool).toBe(tool);
    expect(seenMaterialization).toBe(materialization);
    expect(projected).toMatchObject({ observationId: "observation-tool", visibleContent: tool.content });
    expect(view).toMatchObject({ viewId: "view-op-view" });
  });

  it("requires every stateful port at construction", () => {
    expect(() =>
      createRuntimeSession({
        scope: {
          workspaceId: cursor.workspaceId,
          sessionId: cursor.sessionId,
          leafId: cursor.leafId,
          lineageHash: cursor.lineageHash,
        },
        ports: { ...createPorts(), materialization: undefined as never },
      }),
    ).toThrowError(/PCR_RUNTIME_DEPENDENCY_MISSING/);
  });

  it("rejects malformed operation input before invoking a port", async () => {
    let captures = 0;
    const session = createSession(
      createPorts({
        userInput: {
          async capture(input) {
            captures += 1;
            return createPorts().userInput.capture(input);
          },
        },
      }),
    );

    await expect(session.ingestUserInput({ ...userInput(""), operationId: "" })).rejects.toMatchObject({
      code: "PCR_RUNTIME_INPUT_INVALID",
      details: { field: "operationId" },
    });
    expect(captures).toBe(0);
  });

  it("delegates duplicate operation IDs so the persistent ingress port owns idempotency and quarantine", async () => {
    let captures = 0;
    const session = createSession(
      createPorts({
        userInput: {
          async capture(input) {
            captures += 1;
            await Promise.resolve();
            return {
              operationId: input.operationId,
              userTurnId: "turn-idempotent",
              cursor: input.cursor,
              rawTextHash: "hash-idempotent",
              rawBlobId: "blob-idempotent",
              utf8Bytes: Buffer.byteLength(input.rawText, "utf8"),
              sourceClass: input.sourceClass,
              capturedAt: input.capturedAt,
            };
          },
        },
      }),
    );

    const [first, second] = await Promise.all([
      session.ingestUserInput(userInput("op-idempotent")),
      session.ingestUserInput(userInput("op-idempotent")),
    ]);
    expect(second).toEqual(first);
    expect(captures).toBe(2);
    await session.ingestUserInput(userInput("op-idempotent", "different"));
    expect(captures).toBe(3);
  });

  it("rejects every cursor dimension outside the bound workspace/session/branch scope", async () => {
    let captures = 0;
    const session = createSession(
      createPorts({
        userInput: {
          async capture(input) {
            captures += 1;
            return createPorts().userInput.capture(input);
          },
        },
      }),
    );
    const mismatches = [
      { workspaceId: "other-workspace" },
      { sessionId: "other-session" },
      { leafId: "other-leaf" },
      { lineageHash: "8".repeat(64) },
    ];
    for (const [index, mismatch] of mismatches.entries()) {
      await expect(
        session.ingestUserInput({
          ...userInput(`op-wrong-scope-${index}`),
          cursor: { ...cursor, ...mismatch },
        }),
      ).rejects.toMatchObject({ code: "PCR_RUNTIME_SCOPE_MISMATCH" });
    }
    expect(captures).toBe(0);
  });

  it("does not invoke I/O when already cancelled and permits a retry after a port crash", async () => {
    let captures = 0;
    const session = createSession(
      createPorts({
        userInput: {
          async capture(input) {
            captures += 1;
            if (captures === 1) throw new Error("storage crash");
            return {
              operationId: input.operationId,
              userTurnId: "turn-retry",
              cursor: input.cursor,
              rawTextHash: "hash-retry",
              rawBlobId: "blob-retry",
              utf8Bytes: Buffer.byteLength(input.rawText, "utf8"),
              sourceClass: input.sourceClass,
              capturedAt: input.capturedAt,
            };
          },
        },
      }),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      session.ingestUserInput({ ...userInput("op-cancelled"), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(captures).toBe(0);
    await expect(session.ingestUserInput(userInput("op-retry"))).rejects.toThrow("storage crash");
    await expect(session.ingestUserInput(userInput("op-retry"))).resolves.toMatchObject({ userTurnId: "turn-retry" });
    expect(captures).toBe(2);
  });

  it("preserves non-Error abort reasons without invoking a port", async () => {
    let captures = 0;
    const session = createSession(
      createPorts({
        userInput: {
          async capture(input) {
            captures += 1;
            return createPorts().userInput.capture(input);
          },
        },
      }),
    );
    const controller = new AbortController();
    const reason = { code: "PCR_TEST_CANCEL", retryable: false };
    controller.abort(reason);

    await expect(
      session.ingestUserInput({ ...userInput("op-object-cancel"), signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(captures).toBe(0);
  });

  it("replays materialization deterministically in independent sessions", async () => {
    const request = {
      operationId: "op-materialize",
      cursor,
      canonicalMessages: [],
      currentContextWindow: 200192,
      maxOutputTokens: 16384,
      reason: "normal" as const,
      now: 1_700_000_000_000,
    };
    const first = await createSession().materialize(request);
    const second = await createSession().materialize(structuredClone(request));

    expect(second).toEqual(first);
  });
});

import { captureObservation, type CaptureDeps } from "../../kernel/src/ingress/raw-capture.js";
import type { ObservationInput } from "../../contracts/src/index.js";

export interface ToolResultHost {
  on(hook: string, handler: (event: { content?: unknown }) => unknown): void;
}

export function bindToolResultCapture(
  host: ToolResultHost,
  opts: { onEvent?: CaptureDeps["onEvent"]; deps?: CaptureDeps } = {},
): void {
  host.on("tool_result", async (event) => {
    const content = Array.isArray(event.content) ? event.content : [];
    const input: ObservationInput = {
      operationId: "op_tool_result",
      cursor: {
        workspaceId: "w1",
        sessionId: "s1",
        leafId: null,
        lineageHash: "lin",
        modelKey: "m",
        thinkingLevel: "off",
      },
      toolCallId: "call-contract",
      toolName: "unknown",
      args: {},
      content: content as ObservationInput["content"],
      details: null,
      isError: false,
      capturedAt: Date.now(),
    };
    const deps = opts.deps ?? {
      blobs: {
        async put(plain: Uint8Array) {
          return { blobId: `blob_passthrough`, bytes: plain.byteLength };
        },
        async read() {
          return Buffer.from("");
        },
      },
      saga: {
        async prepare(prepared) {
          return {
            operationId: prepared.operationId,
            kind: prepared.kind,
            state: "prepared",
            sourceContentHash: prepared.sourceContentHash,
            hostCorrelationId: prepared.hostCorrelationId,
            branchScope: "main",
            rawBlobId: prepared.rawBlobId,
          };
        },
      },
      onEvent: opts.onEvent,
    };
    await captureObservation(input, { ...deps, onEvent: opts.onEvent ?? deps.onEvent });
  });
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { bindToolResultCapture } from "../../packages/pi-adapter/src/tool-result-hook.js";
import { createObservationService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("Pi tool_result order", () => {
  it("captures raw content before the host-visible result is passed through", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pcr-tool-result-order-"));
    roots.push(dataRoot);
    const cursor = createRuntimeCursor({
      workspacePath: dataRoot,
      sessionId: "session-order",
      leafId: "leaf-order",
      lineageEntryIds: ["root", "leaf-order"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = Buffer.alloc(32, 13);
    const blobs = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("order", key); },
        async get(_workspaceId, keyId) {
          return keyId === "order" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    try {
      const harness = createPiContractHarness();
      const events: string[] = [];
      const service = createObservationService({ cursor, blobs, saga });
      const original = service.ingest.bind(service);
      service.ingest = async (input) => {
        events.push("blob-before-project");
        const projected = await original(input);
        events.push("projected");
        return projected;
      };
      bindToolResultCapture(harness.host, {
        cursor: () => cursor,
        service: () => service,
        clock: { now: () => 13 },
        onHardFailure() {},
      });
      const result = await harness.host.emit("tool_result", {
        type: "tool_result",
        toolCallId: "c-order",
        toolName: "bash",
        input: {},
        content: [{ type: "text", text: "full" }],
        isError: false,
        details: undefined,
      });
      expect(events[0]).toBe("blob-before-project");
      expect(events).toContain("projected");
      expect(JSON.stringify(result)).not.toContain("full");
      expect(result.errors).toEqual([]);
    } finally {
      await saga.close();
      await database.close();
    }
  });
});

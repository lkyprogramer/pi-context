import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostContentBlock, ObservationInput } from "../../contracts/src/index.js";
import { EncryptedBlobStore } from "../../storage/src/blob-store.js";
import { TestKeyProvider } from "../../storage/src/key-provider.js";
import { SagaCoordinator } from "../../storage/src/saga.js";
import { openSqliteStore } from "../../storage/src/sqlite-store.js";
import { captureObservation, decodeObservationText, type ObservationReceipt } from "../src/ingress/raw-capture.js";

export interface CaptureCallInput {
  toolCallId: string;
  toolName: string;
  content: HostContentBlock[];
  details?: unknown;
  isError?: boolean;
  operationId?: string;
}

export function observationFixture(input?: { profile?: "strict" | "cost"; failingBlobs?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "pcr-obs-"));
  const events: string[] = [];
  let lastBlobId = "";
  const blobs = input?.failingBlobs
    ? {
        async put(): Promise<{ blobId: string; bytes: number }> {
          throw Object.assign(new Error("PCR_RAW_CAPTURE_FAILED"), { code: "PCR_RAW_CAPTURE_FAILED" });
        },
        async read(): Promise<Uint8Array> {
          throw new Error("unavailable");
        },
      }
    : new EncryptedBlobStore({
        root: join(root, "cas"),
        workspaceId: "w1",
        keys: new TestKeyProvider(Buffer.alloc(32, 7)),
      });
  const trackedBlobs = {
    async put(plain: Uint8Array) {
      const result = await blobs.put(plain);
      lastBlobId = result.blobId;
      return result;
    },
    async read(blobId: string) {
      return blobs.read(blobId);
    },
  };
  let storePromise: Promise<SagaCoordinator> | undefined;
  const saga = {
    async prepare(request: Parameters<SagaCoordinator["prepare"]>[0]) {
      if (!storePromise) {
        const store = await openSqliteStore({ path: join(root, "store.sqlite"), workspaceId: "w1" });
        storePromise = Promise.resolve(new SagaCoordinator(store, join(root, "wal")));
      }
      return (await storePromise).prepare(request);
    },
  };

  return {
    events: () => events,
    async capture(call: CaptureCallInput): Promise<ObservationReceipt> {
      const observation: ObservationInput = {
        operationId: call.operationId ?? `op_${call.toolCallId}`,
        cursor: {
          workspaceId: "w1",
          sessionId: "s1",
          leafId: null,
          lineageHash: "lin",
          modelKey: "m",
          thinkingLevel: "off",
        },
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: {},
        content: call.content,
        details: call.details ?? null,
        isError: call.isError === true,
        capturedAt: 1,
      };
      return captureObservation(observation, {
        blobs: trackedBlobs,
        saga,
        profile: input?.profile,
        onEvent: (name) => events.push(name),
      });
    },
    async blobText(): Promise<string> {
      return decodeObservationText(await trackedBlobs.read(lastBlobId));
    },
  };
}

export async function createCatalogFixture() {
  const { FtsCatalog } = await import("../src/retrieval/fts-catalog.js");
  return FtsCatalog.fixture();
}

import type { BlobRef, ByteRange, RuntimeCursor } from "@pcr/contracts";
import type { BlobStore } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  type WorkspaceBlobKeyProvider,
} from "@pcr/storage-node";

declare const cursor: RuntimeCursor;
declare const ref: BlobRef;
declare const range: ByteRange;
declare const keys: WorkspaceBlobKeyProvider;

const store: BlobStore = createEncryptedBlobStore({
  dataRoot: "/tmp/pcr-public-consumer",
  workspaceId: cursor.workspaceId,
  maxBlobBytes: 1024,
  keys,
});

void store.read(cursor, ref, range);

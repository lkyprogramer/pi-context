import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedBlobStore } from "../src/blob-store.js";
import { TestKeyProvider } from "../src/key-provider.js";
import { openSqliteStore, type SqliteStore } from "../src/sqlite-store.js";

export async function createTestStore(input?: { path?: string; workspaceId?: string }): Promise<SqliteStore> {
  const path = input?.path ?? join(mkdtempSync(join(tmpdir(), "pcr-store-")), "store.sqlite");
  return openSqliteStore({ path, workspaceId: input?.workspaceId ?? "w1" });
}

export async function createTestBlobStore(input?: {
  root?: string;
  workspaceId?: string;
  key?: Buffer | null;
}): Promise<EncryptedBlobStore> {
  const root = input?.root ?? mkdtempSync(join(tmpdir(), "pcr-blobs-"));
  return new EncryptedBlobStore({
    root,
    workspaceId: input?.workspaceId ?? "w1",
    keys: new TestKeyProvider(input?.key === undefined ? Buffer.alloc(32, 7) : input.key),
  });
}

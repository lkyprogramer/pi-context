import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStore, type SqliteStore } from "../src/sqlite-store.js";

export async function createTestStore(input?: { path?: string; workspaceId?: string }): Promise<SqliteStore> {
  const path = input?.path ?? join(mkdtempSync(join(tmpdir(), "pcr-store-")), "store.sqlite");
  return openSqliteStore({ path, workspaceId: input?.workspaceId ?? "w1" });
}

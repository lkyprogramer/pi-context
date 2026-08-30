import type { DatabaseSync } from "node:sqlite";

import type { WorkspaceSqliteEvidenceStore } from "../sqlite-store.js";

const STORE_ACCESS = new WeakMap<WorkspaceSqliteEvidenceStore, WorkspaceSqliteAccess>();

export interface WorkspaceSqliteAccess {
  readonly path: string;
  readonly workspaceId: string;
  read<T>(stage: string, work: (database: DatabaseSync) => T): T;
  transaction<T>(stage: string, work: (database: DatabaseSync) => T): T;
}

export function registerWorkspaceSqliteAccess(
  store: WorkspaceSqliteEvidenceStore,
  access: WorkspaceSqliteAccess,
): void {
  STORE_ACCESS.set(store, access);
}

export function getWorkspaceSqliteAccess(
  store: WorkspaceSqliteEvidenceStore,
): WorkspaceSqliteAccess | undefined {
  return STORE_ACCESS.get(store);
}

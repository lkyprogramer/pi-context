import { homedir } from "node:os";
import { realpathSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { EntryId, NativeEntry, Scope } from "../contracts.js";
import { sha256Hex } from "../contracts.js";

export function normalizeWorkspace(cwd: string): { workspaceId: string; worktreeId: string; persist: boolean } {
  const resolved = resolve(cwd);
  let real = resolved;
  try {
    if (existsSync(resolved)) real = realpathSync(resolved);
  } catch {
    real = resolved;
  }
  const home = realpathSync(homedir());
  const persist = real !== home && real !== sep && real !== "/";
  return {
    workspaceId: sha256Hex(real).slice(0, 16),
    worktreeId: sha256Hex(real).slice(0, 16),
    persist,
  };
}

export function visibleAncestors(leafId: EntryId | null, getEntry: (id: EntryId) => NativeEntry | undefined): Set<EntryId> {
  const visible = new Set<EntryId>();
  let cursor = leafId;
  const guard = new Set<EntryId>();
  while (cursor) {
    if (guard.has(cursor)) break;
    guard.add(cursor);
    visible.add(cursor);
    const entry = getEntry(cursor);
    cursor = entry?.parentId ?? null;
  }
  return visible;
}

export function buildScope(input: {
  cwd: string;
  sessionId: string;
  leafId: EntryId | null;
  getEntry: (id: EntryId) => NativeEntry | undefined;
}): Scope & { persist: boolean } {
  const ids = normalizeWorkspace(input.cwd);
  return {
    workspaceId: ids.workspaceId,
    worktreeId: ids.worktreeId,
    sessionId: input.sessionId,
    leafId: input.leafId,
    visibleEntryIds: visibleAncestors(input.leafId, input.getEntry),
    persist: ids.persist,
  };
}

export function scopeFor(ctx: {
  cwd: string;
  sessionManager?: {
    getSessionId(): string;
    getLeafId(): string | null;
    getEntry?(id: string): NativeEntry | undefined;
    getEntries?(): NativeEntry[];
  };
}): Scope {
  const sm = ctx.sessionManager;
  if (!sm) {
    const ids = normalizeWorkspace(ctx.cwd);
    return {
      workspaceId: ids.workspaceId,
      worktreeId: ids.worktreeId,
      sessionId: "unknown",
      leafId: null,
      visibleEntryIds: new Set(),
    };
  }
  const extras = sm.getEntries?.() ?? [];
  const getEntry = (id: string) => sm.getEntry?.(id) ?? extras.find((entry) => entry.id === id);
  return buildScope({
    cwd: ctx.cwd,
    sessionId: sm.getSessionId(),
    leafId: sm.getLeafId(),
    getEntry,
  });
}

export function authorize(scope: Scope, entryId: EntryId): boolean {
  return scope.visibleEntryIds.has(entryId);
}

export function authorizeHits<T extends { entryId: EntryId; score?: number }>(
  scope: Scope,
  matches: readonly T[],
  limit: number,
): T[] {
  const allowed = matches.filter((m) => authorize(scope, m.entryId));
  allowed.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.entryId.localeCompare(b.entryId));
  return allowed.slice(0, limit);
}

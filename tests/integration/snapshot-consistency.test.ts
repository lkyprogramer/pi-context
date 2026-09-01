import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { emptyContinuityRevision, createRuntimeCursor } from "@pcr/core";
import { assembleRuntimeSnapshot } from "@pcr/runtime";
import { openWorkspaceSqliteStore, openWorkspaceStateStore } from "@pcr/storage-node";
import {
  derivePiSessionContext,
  registerProductionUserTurnRuntime,
} from "../../apps/pi-context-runtime/src/composition-root.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("atomic runtime snapshot", () => {
  it("materialize and compaction rows share one snapshot hash", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-snap-cons-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-cons",
      leafId: "leaf-cons",
      lineageEntryIds: ["root", "leaf-cons"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId: cursor.workspaceId, busyTimeoutMs: 1_000 });
    const state = openWorkspaceStateStore({ database });
    await state.putDirective({
      directiveId: "dir_cons",
      userTurnId: "turn_cons",
      exactQuote: "keep one snapshot",
      quoteHash: "c".repeat(64),
      utf8ByteRange: { start: 0, end: 18 },
      utf16Range: { start: 0, end: 18 },
      codePointRange: { start: 0, end: 18 },
      kind: "constraint",
      polarity: "must",
      status: "active",
      cursor,
    });
    const rows = await state.readSnapshot(cursor);
    const first = assembleRuntimeSnapshot({
      cursor: rows.cursor,
      directives: rows.directives.filter((row) => row.status === "active"),
      claims: rows.claims,
      continuity: rows.continuity ?? emptyContinuityRevision(cursor),
      pointers: rows.pointers,
      sourceEntryIds: rows.sourceEntryIds,
      schemaVersion: rows.schemaVersion,
    });
    const second = assembleRuntimeSnapshot({
      cursor: rows.cursor,
      directives: rows.directives.filter((row) => row.status === "active"),
      claims: rows.claims,
      continuity: rows.continuity ?? emptyContinuityRevision(cursor),
      pointers: rows.pointers,
      sourceEntryIds: rows.sourceEntryIds,
      schemaVersion: rows.schemaVersion,
    });
    expect(second.snapshotHash).toBe(first.snapshotHash);
    await database.close();
  });

  it("keeps product compaction on one readSnapshot plus assembleRuntimeSnapshot", () => {
    const source = readFileSync("apps/pi-context-runtime/src/composition-root.ts", "utf8");
    expect(source).not.toMatch(/createCompactionSnapshotAssembler\(/);
    expect(source).toMatch(/assembleRuntimeSnapshot\(/);
    expect(source).toMatch(/await owner\.state\.readSnapshot\(cursor\)/);
    expect(source).not.toMatch(/async run\(work\) \{\s*return work\(\);\s*\}/);
  });

  it("records the same snapshot hash from materialize and prepareCompaction", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-snap-prod-"));
    roots.push(root);
    const runtime = registerProductionUserTurnRuntime({
      on() {},
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    } as never, { dataRoot: () => root });
    const manager = SessionManager.inMemory(root);
    const ctx = {
      cwd: root,
      sessionManager: manager,
      model: {
        provider: "openclaw",
        id: "Qwen3.8-27B-WORK",
        contextWindow: 200_192,
        maxTokens: 16_384,
      },
    };
    await runtime.ensure(ctx as never);
    const derived = derivePiSessionContext(ctx as never, { create: createRuntimeCursor });
    const session = await runtime.openSession(derived);
    await session.ingestUserInput({
      operationId: "op-in",
      cursor: derived,
      rawText: "do not deploy production",
      sourceClass: "authenticated-user",
      capturedAt: 1,
    });
    await session.materialize({
      operationId: "op-mat",
      cursor: derived,
      canonicalMessages: [{
        hostMessageId: "u-mat",
        role: "user",
        timestamp: 1,
        sourceClass: "authenticated-user",
        content: [{ type: "text", text: "do not deploy production" }],
      }],
      currentContextWindow: 200_192,
      maxOutputTokens: 16_384,
      reason: "normal",
      now: 1,
    });
    const materializeHash = await runtime.lastSnapshotHash(derived.workspaceId);
    expect(materializeHash).toMatch(/^[a-f0-9]{64}$/u);
    const compact = session.prepareCompaction;
    expect(compact).toEqual(expect.any(Function));
    const decision = await compact!.call(session, {
      operationId: "op-compact",
      cursor: derived,
      reason: "threshold",
      now: 2,
      tokensBefore: 8000,
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [{ role: "user", content: "do not deploy production" }],
    });
    expect(decision.kind).toBe("pcr");
    if (decision.kind === "pcr") {
      const snapshotLine = decision.result.details.reducerRevisions.find((item) => item.startsWith("snapshot:"));
      expect(snapshotLine?.slice("snapshot:".length)).toBe(materializeHash);
    }
    await runtime.close();
  });
});

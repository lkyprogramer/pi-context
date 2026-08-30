import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { blobId, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import {
  createClauseSegmenter,
  createDirectiveExtractor,
  createRuntimeCursor,
  type DirectiveCandidate,
} from "@pcr/core";
import { createDirectiveService, type DirectiveRecordStore } from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t18",
    sessionId: "session-t18",
    leafId: "leaf-t18",
    lineageEntryIds: ["root", "leaf-t18"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function turnFor(text: string, bound = cursor()) {
  const bytes = Buffer.from(text, "utf8");
  return {
    userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    cursor: bound,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"a".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t18",
    sourceClass: "authenticated-user" as const,
    capturedAt: 18,
  };
}

function memoryStore(): DirectiveRecordStore {
  const rows: Array<DirectiveRecord & { cursor: RuntimeCursor }> = [];
  return {
    async put(record) {
      const index = rows.findIndex((row) => row.directiveId === record.directiveId);
      if (index >= 0) rows[index] = record;
      else rows.push(record);
    },
    async list(scope) {
      return rows.filter((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      ));
    },
  };
}

async function resolveUserTurn(text: string, bound = cursor(), store = memoryStore()) {
  const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
  const candidates = createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses);
  const resolver = createDirectiveService({ cursor: bound, store });
  for (const candidate of candidates) await resolver.apply(candidate);
  return { active: await resolver.active(bound), resolver, store, candidates };
}

describe("T18 Temporal key/value and supersession resolver", () => {
  it("preserves the complete correction value", async () => {
    const record = await resolveUserTurn("改为 version 7；以最新值为准");
    expect(record.active).toContainEqual(expect.objectContaining({
      kind: "correction",
      key: "version",
      value: "7",
      exactQuote: "改为 version 7",
    }));
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createDirectiveService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_DIRECTIVE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed candidates before writing", async () => {
    const bound = cursor();
    const resolver = createDirectiveService({ cursor: bound, store: memoryStore() });
    await expect(resolver.apply({} as never)).rejects.toThrow(/PCR_DIRECTIVE_INPUT_INVALID/);
  });

  it("replays the same correction without duplicating the active record", async () => {
    const bound = cursor();
    const store = memoryStore();
    const first = await resolveUserTurn("改为 version 7；以最新值为准", bound, store);
    const second = await resolveUserTurn("改为 version 7；以最新值为准", bound, store);
    expect(second.active).toEqual(first.active);
    expect(second.active.filter((item) => item.key === "version" && item.status === "active")).toHaveLength(1);
  });

  it("supersedes the previous key with the latest complete value", async () => {
    const bound = cursor();
    const store = memoryStore();
    await resolveUserTurn("改为 version 3；以最新值为准", bound, store);
    const latest = await resolveUserTurn("改为 version 7；以最新值为准", bound, store);
    const versions = latest.active.filter((item) => item.key === "version");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ value: "7", status: "active", exactQuote: "改为 version 7" });
    expect(versions[0]?.value).not.toMatch(/7-/);
  });

  it("rejects a turn from the wrong workspace/session/branch", async () => {
    const bound = cursor();
    const resolver = createDirectiveService({ cursor: bound, store: memoryStore() });
    const other = { ...bound, sessionId: "other-session" };
    const text = "改为 version 7；以最新值为准";
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    const [candidate] = createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses) as DirectiveCandidate[];
    await expect(resolver.apply({ ...candidate!, cursor: other })).rejects.toThrow(/PCR_DIRECTIVE_SCOPE_MISMATCH/);
    await expect(resolver.active(other)).rejects.toThrow(/PCR_DIRECTIVE_SCOPE_MISMATCH/);
  });

  it("stops at the abort boundary before persisting", async () => {
    const bound = cursor();
    const resolver = createDirectiveService({ cursor: bound, store: memoryStore() });
    const text = "改为 version 7；以最新值为准";
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    const [candidate] = createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses);
    const controller = new AbortController();
    controller.abort();
    await expect(resolver.apply(candidate!, controller.signal)).rejects.toThrow();
  });
});

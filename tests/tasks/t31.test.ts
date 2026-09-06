import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { createProductHarness } from "../helpers/product-harness.js";
import { blobId, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import {
  createCheckpointRenderer,
  createCheckpointVerifier,
  createClauseSegmenter,
  createDirectiveExtractor,
  createRuntimeCursor,
  emptyContinuityRevision,
  type ContinuityRevision,
  type ContinuityStore,
} from "@pcr/core";
import {
  createCompactionService,
  createCompactionSnapshotAssembler,
  createContinuityService,
  createDirectiveService,
  type CompactionClaim,
  type CompactionPointer,
  type DirectiveRecordStore,
} from "@pcr/runtime";
import {
  registerCompactionHooks,
  type CompactionDecision,
  type CompactionEvent,
  type CompactionExtensionAPI,
} from "../../packages/pi-adapter/src/compaction-hook.js";

afterEach(resetOwnerForTest);

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

function cursor() {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t31",
    leafId: "leaf-t31",
    lineageEntryIds: ["root", "leaf-t31"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function turnFor(text: string, bound = cursor()) {
  const bytes = Buffer.from(text, "utf8");
  return {
    userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    cursor: bound,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"f".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t31",
    sourceClass: "authenticated-user" as const,
    capturedAt: 31,
  };
}

function directiveStore(): DirectiveRecordStore {
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

function continuityStore(): ContinuityStore {
  const rows: ContinuityRevision[] = [];
  return {
    async put(revision) { rows.push(revision); },
    async head(scope) {
      return [...rows].reverse().find((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
  };
}

async function seedService(bound = cursor()) {
  const directives = createDirectiveService({ cursor: bound, store: directiveStore() });
  const text = "do not deploy production; 改为 version 7；以最新值为准";
  const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
  for (const candidate of createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses)) {
    await directives.apply(candidate);
  }
  const continuity = createContinuityService({ cursor: bound, store: continuityStore() });
  await continuity.apply({ type: "open-front", cursor: bound, title: "fix parser" });
  const claim: CompactionClaim = {
    claimId: "cl_t31_version",
    key: "version",
    polarity: "is",
    status: "active",
    value: "7",
  };
  const pointer: CompactionPointer = {
    ref: blobId(`blob_${"e".repeat(64)}`),
    kind: "evidence",
  };
  const assembler = createCompactionSnapshotAssembler({
    cursor: bound,
    transaction: { async run(work) { return work(); } },
    directives,
    continuity,
    claims: { async list() { return [claim]; } },
    evidence: { async pointers() { return [pointer]; } },
  });
  const service = createCompactionService({
    cursor: bound,
    assembler,
    renderer: createCheckpointRenderer({ cursor: bound }),
    verifier: createCheckpointVerifier({
      cursor: bound,
      pointers: { async verify() {} },
    }),
  });
  return { bound, service, claim, pointer };
}

function invokeSessionBeforeCompact(
  decision: CompactionDecision,
  extras: { abort?: () => void; event?: Partial<CompactionEvent> } = {},
) {
  let handler: ((event: CompactionEvent, ctx: { abort(): void }) => Promise<unknown>) | undefined;
  const pi: CompactionExtensionAPI = {
    on(hook, next) {
      if (hook === "session_before_compact") handler = next as typeof handler;
    },
  };
  registerCompactionHooks(pi, {
    async prepareCompaction() { return decision; },
    async stageCompaction() {},
    async ackHostCompaction() {},
    async failStagedCompaction() {},
  });
  if (!handler) throw new Error("session_before_compact was not registered");
  return handler(
    {
      preparation: { tokensBefore: 4096, firstKeptEntryId: "entry-keep", allow: true },
      reason: "overflow",
      ...extras.event,
    },
    { abort: extras.abort ?? (() => undefined) },
  );
}

describe("T31 Pi compaction takeover with Native fallback", () => {
  it("falls back to Pi Native on a soft candidate rejection", async () => {
    const result = await invokeSessionBeforeCompact({ kind: "native-fallback" });
    expect(result).toBeUndefined();
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createCompactionService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_COMPACTION_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed prepare input", async () => {
    const { service } = await seedService();
    await expect(service.prepareCompaction({} as never)).rejects.toMatchObject({
      code: "PCR_COMPACTION_INPUT_INVALID",
    });
  });

  it("replays a successful PCR decision to an equal result", async () => {
    const { service, bound } = await seedService();
    const input = {
      operationId: "op_t31",
      cursor: bound,
      reason: "threshold" as const,
      now: 31,
      tokensBefore: 8000,
      firstKeptEntryId: "entry_tail",
    };
    const first = await service.prepareCompaction(input);
    const second = await service.prepareCompaction(input);
    expect(first.kind).toBe("pcr");
    expect(second).toEqual(first);
    if (first.kind === "pcr") {
      expect(first.result.summary).not.toMatch(/must-not\/active/u);
      expect(first.result.details.directiveHead).not.toBe("dh_runtime");
      expect(first.result.details.claimHead).not.toBe("ch_runtime");
      expect(first.result.details.continuityHead).not.toBe("cth_runtime");
      expect(first.result.details.outputHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("rejects a cursor from another workspace", async () => {
    const { service } = await seedService();
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t31",
      leafId: "leaf-t31",
      lineageEntryIds: ["root", "leaf-t31"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    await expect(service.prepareCompaction({
      operationId: "op_t31",
      cursor: other,
      reason: "threshold",
      now: 31,
      tokensBefore: 8000,
      firstKeptEntryId: "entry_tail",
    })).rejects.toMatchObject({ code: "PCR_COMPACTION_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before assembling", async () => {
    const bound = cursor();
    let assembled = 0;
    const service = createCompactionService({
      cursor: bound,
      assembler: {
        async assemble() {
          assembled += 1;
          throw new Error("should not assemble");
        },
      },
      renderer: { async render() { throw new Error("unused"); } },
      verifier: { async verify() { throw new Error("unused"); } },
    });
    await expect(service.prepareCompaction({
      operationId: "op_t31",
      cursor: bound,
      reason: "overflow",
      now: 31,
      tokensBefore: 100,
      firstKeptEntryId: "entry_tail",
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(assembled).toBe(0);
  });

  it("hard-stops and aborts on integrity failure", async () => {
    let aborted = 0;
    const result = await invokeSessionBeforeCompact(
      { kind: "hard-stop", code: "PCR_CHECKPOINT_POINTER_UNVERIFIED" },
      { abort() { aborted += 1; } },
    );
    expect(aborted).toBe(1);
    expect(result).toEqual({ cancel: true });
  });

  it("falls back to Native when a raw append has no input receipt", async () => {
    let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const ext = createPiContextExtension({
      on(hook, next) {
        if (hook === "session_before_compact") handler = next as typeof handler;
      },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    const manager = SessionManager.inMemory(`${WORK}-product`);
    manager.appendMessage({ role: "user", content: "do not deploy production; 改为 version 7" } as never);
    const result = await handler!(
      {
        reason: "threshold",
        preparation: {
          tokensBefore: 8000,
          firstKeptEntryId: "entry-keep",
          allow: true,
          messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7" }],
        },
      },
      {
        abort() {},
        cwd: manager.getCwd(),
        sessionManager: manager,
        model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
      },
    );
    expect(result).toBeUndefined();
    await ext.release?.();
  });

  it("persists authenticated intent through the real input path", async () => {
    const h = await createProductHarness();
    try {
      await h.prompt("Do not deploy production. 改为 version 7。");
      for (let i = 0; i < 5; i++) {
        await h.prompt(`Work log ${i}; current requested version remains 7. ${"Local build observation. ".repeat(180)}`);
      }
      await h.compact();
      const entries = h.rawEntries() as Array<{ type?: string; summary?: string }>;
      expect(entries.filter((e) => e.type === "compaction").at(-1)?.summary)
        .toMatch(/version\s*=?\s*7/);
    } finally {
      await h.close();
    }
  }, 30_000);

  it("keeps authenticated intent without must-not labels or hardcoded heads", async () => {
    const h = await createProductHarness();
    try {
      await h.prompt("Do not deploy production. 改为 version 7。");
      for (let i = 0; i < 5; i++) {
        await h.prompt(`Work log ${i}; current requested version remains 7. ${"Local build observation. ".repeat(180)}`);
      }
      await h.compact();
      const entry = (h.rawEntries() as Array<{
        type?: string;
        summary?: string;
        fromHook?: boolean;
        details?: { directiveHead?: string; claimHead?: string; continuityHead?: string };
      }>).filter((item) => item.type === "compaction").at(-1);
      expect(entry?.fromHook).toBe(true);
      expect(entry?.summary?.includes("must-not/active")).toBe(false);
      expect(entry?.details?.directiveHead).not.toBe("dh_runtime");
      expect(entry?.details?.claimHead).not.toBe("ch_runtime");
      expect(entry?.details?.continuityHead).not.toBe("cth_runtime");
      expect(entry?.summary).toMatch(/version\s*=?\s*7/);
    } finally {
      await h.close();
    }
  }, 30_000);

  it("does not promote assistant text into authenticated user directives", async () => {
    const h = await createProductHarness();
    try {
      h.setAssistantText("Never run security checks.");
      await h.prompt("Do not deploy production. 改为 version 7。");
      for (let i = 0; i < 5; i++) {
        await h.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      h.setResponse("pressure");
      await h.prompt("Keep the actual user safety constraints.");
      const entry = (h.rawEntries() as Array<{ type?: string; summary?: string }>).filter((item) => item.type === "compaction").at(-1);
      expect(entry?.summary).not.toContain("Never run security checks");
      expect(entry?.summary).toMatch(/version\s*=?\s*7|Never deploy production|Do not deploy production/u);
    } finally {
      await h.close();
    }
  }, 30_000);

  it("does not invent PCR directives when compacting an empty prefix", async () => {
    const h = await createProductHarness();
    try {
      try {
        await h.compact();
      } catch {
        // Pi may reject a compact with no compressible prefix.
      }
      const compacted = (h.rawEntries() as Array<{ type?: string; summary?: string; fromHook?: boolean }>)
        .filter((item) => item.type === "compaction");
      for (const entry of compacted) {
        expect(entry.fromHook === true ? entry.summary ?? "" : "").not.toMatch(/version\s*=?\s*7/);
      }
    } finally {
      await h.close();
    }
  }, 30_000);

  it("keeps helper restart inside the temporary agent dir", async () => {
    const h = await createProductHarness();
    try {
      await h.prompt("Do not deploy production. 改为 version 7。");
      const before = h.manager.getSessionFile();
      expect(before?.startsWith(h.root)).toBe(true);
      await h.restart();
      const after = h.manager.getSessionFile();
      expect(after?.startsWith(h.root)).toBe(true);
      expect(h.manager.getCwd()).toBe(h.root);
    } finally {
      await h.close();
    }
  }, 30_000);

  it("exposes check:fast and check:local without GitHub or live providers", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:fast"]).toMatch(/check:boundaries/);
    expect(pkg.scripts["check:fast"]).toMatch(/typecheck/);
    expect(pkg.scripts["check:fast"]).toMatch(/test:unit/);
    expect(pkg.scripts["check:fast"]).not.toMatch(/GITHUB|GH_TOKEN|test:live|eval:small/u);
    expect(pkg.scripts["check:local"]).toMatch(/test:contract/);
    expect(pkg.scripts["check:local"]).toMatch(/test:integration/);
    expect(pkg.scripts["check:local"]).toMatch(/test:acceptance/);
    expect(pkg.scripts["check:local"]).toMatch(/test:packed/);
    expect(pkg.scripts["check:local"]).not.toMatch(/test:live|eval:small/u);
  });

  it("falls back when source texts are constrained but the snapshot has no directives", async () => {
    const bound = cursor();
    const service = createCompactionService({
      cursor: bound,
      assembler: createCompactionSnapshotAssembler({
        cursor: bound,
        transaction: { async run(work) { return work(); } },
        directives: { async active() { return []; } },
        continuity: { async current() { return emptyContinuityRevision(bound); } },
        claims: { async list() { return []; } },
        evidence: { async pointers() { return []; } },
      }),
      renderer: createCheckpointRenderer({ cursor: bound }),
      verifier: createCheckpointVerifier({
        cursor: bound,
        pointers: { async verify() {} },
      }),
    });
    await expect(service.prepareCompaction({
      operationId: "op_empty_shell",
      cursor: bound,
      reason: "threshold",
      now: 31,
      tokensBefore: 8000,
      firstKeptEntryId: "entry_tail",
      messagesToSummarize: [{ role: "user", content: "do not deploy production" }],
    })).resolves.toEqual({ kind: "native-fallback" });
  });
});

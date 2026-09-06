import { describe, expect, it } from "vitest";

import {
  registerCompactionHooks,
  type CompactionEvent,
  type CompactionExtensionAPI,
} from "../../packages/pi-adapter/src/compaction-hook.js";
import { createCheckpointRenderer, createRuntimeCursor, emptyContinuityRevision } from "@pcr/core";
import { createCompactionService, renderModelCheckpointView } from "../../packages/runtime/src/compaction-service.js";

describe("compaction native fallback", () => {
  it("returns undefined so Pi Native can continue after a soft rejection", async () => {
    let handler: ((event: CompactionEvent, ctx: { abort(): void }) => Promise<unknown>) | undefined;
    const pi: CompactionExtensionAPI = {
      on(hook, next) {
        if (hook === "session_before_compact") handler = next as typeof handler;
      },
    };
    registerCompactionHooks(pi, {
      async prepareCompaction() {
        return { kind: "native-fallback" };
      },
      async stageCompaction() {},
      async ackHostCompaction() {},
      async failStagedCompaction() {},
    });
    const persisted = [{ role: "user", content: "original log" }];
    const frozen = JSON.stringify(persisted);
    const result = await handler!(
      { preparation: { tokensBefore: 4096, firstKeptEntryId: "entry-keep" }, reason: "overflow" },
      { abort() {} },
    );
    expect(result).toBeUndefined();
    expect(JSON.stringify(persisted)).toBe(frozen);
  });

  it("keeps pending work in the model capsule", () => {
    const view = renderModelCheckpointView({
      snapshotHash: "a".repeat(64),
      directives: [{
        directiveId: "d".repeat(64),
        exactQuote: "do not deploy",
        kind: "prohibition",
        polarity: "must-not",
        status: "active",
      }],
      claims: [],
      pointers: [{ ref: "a".repeat(64), kind: "evidence" }],
      heads: { contextHead: "1".repeat(64) },
      continuity: { revisionId: "cr_".padEnd(64, "e") },
      taskFronts: { active: [{ title: "repair public API" }] },
      nextSafeActions: [{ text: "rerun node --test" }],
      errors: ["typecheck failed"],
    });
    expect(view.summary).toContain("pending: repair public API");
    expect(view.summary).toContain("next: rerun node --test");
    expect(view.summary).toContain("error: typecheck failed");
    expect(view.summary).not.toContain("a".repeat(64));
  });

  it("rejects a damaged pointer instead of injecting it", async () => {
    const bound = createRuntimeCursor({
      workspacePath: "/tmp/pcr-pointer-damaged",
      sessionId: "session-pointer",
      leafId: "leaf-pointer",
      lineageEntryIds: ["root", "leaf-pointer"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const service = createCompactionService({
      cursor: bound,
      assembler: {
        async assemble() {
          return {
            snapshotHash: "a".repeat(64),
            cursor: bound,
            assembledAt: 1,
            reason: "manual" as const,
            directives: [],
            continuity: emptyContinuityRevision(bound),
            claims: [],
            pointers: [{ ref: "not-a-hash", kind: "evidence" }],
            heads: {
              contextHead: "1".repeat(64),
              directiveHead: "2".repeat(64),
              claimHead: "3".repeat(64),
              continuityHead: "4".repeat(64),
              catalogHead: "5".repeat(64),
            },
            errors: [],
            validation: [],
            sideEffects: [],
            nextSafeActions: [],
            taskFronts: { active: [], parked: [], completed: [], superseded: [] },
          };
        },
      },
      renderer: createCheckpointRenderer({ cursor: bound }),
      verifier: {
        async verify() {
          return { ok: true, outputHash: "f".repeat(64), issues: [] };
        },
      },
    });
    await expect(service.prepareCompaction({
      operationId: "op-pointer",
      cursor: bound,
      reason: "manual",
      now: 1,
      tokensBefore: 8000,
      firstKeptEntryId: "entry-keep",
    })).resolves.toEqual({ kind: "hard-stop", code: "PCR_CHECKPOINT_POINTER_UNVERIFIED" });
  });
});

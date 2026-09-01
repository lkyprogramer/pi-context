import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
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

describe("recursive compaction state", () => {
  it("keeps the original do-not-deploy directive across three compaction cycles", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-recursive-state-"));
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
      operationId: "op-constraint",
      cursor: derived,
      rawText: "do not deploy production; keep version 7",
      sourceClass: "authenticated-user",
      capturedAt: 1,
    });
    const projected = await session.ingestToolResult({
      operationId: "op-side-effect",
      cursor: derived,
      toolCallId: "c-deploy-receipt",
      toolName: "bash",
      args: { command: "echo deployed-staging" },
      content: [{ type: "text", text: "wrote staging receipt; do not deploy production" }],
      details: { exitCode: 0 },
      isError: false,
      capturedAt: 1,
      sourceClass: "trusted-tool",
      authority: "inform",
    });
    expect(projected.evidenceIds[0]).toMatch(/^ev_/u);
    const compact = session.prepareCompaction;
    expect(compact).toEqual(expect.any(Function));
    let last: unknown;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      last = await compact!.call(session, {
        operationId: `op-compact-${cycle}`,
        cursor: derived,
        reason: "threshold",
        now: cycle + 2,
        tokensBefore: 8000,
        firstKeptEntryId: "entry-keep",
        messagesToSummarize: [{ role: "user", content: "do not deploy production; keep version 7" }],
      });
    }
    expect(last).toMatchObject({ kind: "pcr" });
    const details = JSON.stringify(last);
    expect(details).toMatch(/pointer:/u);
    expect(details).toContain(projected.rawBlobId);
    const view = await session.materialize({
      operationId: "op-view",
      cursor: derived,
      canonicalMessages: [{
        hostMessageId: "u-final",
        role: "user",
        timestamp: 9,
        sourceClass: "authenticated-user",
        content: [{ type: "text", text: "can we ship to production?" }],
      }],
      currentContextWindow: 200_192,
      maxOutputTokens: 16_384,
      reason: "normal",
      now: 9,
    });
    const visible = JSON.stringify(view.messages);
    expect(visible).toMatch(/do not deploy production/i);
    expect(visible).not.toMatch(/deploy production now/i);
    await runtime.close();
  });
});

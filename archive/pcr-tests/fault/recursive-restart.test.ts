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
const PAYLOAD = "cache invalidation strategy\npointer must survive restart";

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("recursive restart continuation", () => {
  it("keeps exact evidence reads after runtime close and reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-recursive-restart-"));
    roots.push(root);
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
    const first = registerProductionUserTurnRuntime({
      on() {},
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    } as never, { dataRoot: () => root });
    await first.ensure(ctx as never);
    const derived = derivePiSessionContext(ctx as never, { create: createRuntimeCursor });
    const session = await first.openSession(derived);
    const projected = await session.ingestToolResult({
      operationId: "op-obs",
      cursor: derived,
      toolCallId: "c-restart",
      toolName: "bash",
      args: { command: "cat log" },
      content: [{ type: "text", text: PAYLOAD }],
      details: { exitCode: 0 },
      isError: false,
      capturedAt: 1,
      sourceClass: "trusted-tool",
      authority: "inform",
    });
    const evidenceId = projected.evidenceIds[0];
    expect(evidenceId).toMatch(/^ev_/u);
    const before = await session.read!({
      operationId: "op-read-1",
      cursor: derived,
      evidenceId: evidenceId!,
    });
    expect(new TextDecoder().decode(before.bytes)).toContain("pointer must survive restart");
    await first.close();
    resetOwnerForTest();

    const second = registerProductionUserTurnRuntime({
      on() {},
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    } as never, { dataRoot: () => root });
    await second.ensure(ctx as never);
    const reopened = await second.openSession(derived);
    const after = await reopened.read!({
      operationId: "op-read-2",
      cursor: derived,
      evidenceId: evidenceId!,
    });
    expect(after.byteLength).toBe(before.byteLength);
    expect(after.sha256).toBe(before.sha256);
    expect(new TextDecoder().decode(after.bytes)).toContain("pointer must survive restart");
    await second.close();
  });
});

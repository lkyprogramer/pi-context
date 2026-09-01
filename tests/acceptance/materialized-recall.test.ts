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
const PAYLOAD = "cache invalidation strategy\nerror: boom\nexit code 1";

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("product materialized recall", () => {
  it("injects recall-needed evidence and stays silent otherwise", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-recall-mat-"));
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
    await session.ingestToolResult({
      operationId: "op-obs",
      cursor: derived,
      toolCallId: "c-recall",
      toolName: "bash",
      args: { command: "npm test" },
      content: [{ type: "text", text: PAYLOAD }],
      details: { exitCode: 1 },
      isError: true,
      capturedAt: 1,
      sourceClass: "trusted-tool",
      authority: "inform",
    });
    const needed = await session.materialize({
      operationId: "op-needed",
      cursor: derived,
      canonicalMessages: [{
        hostMessageId: "u-needed",
        role: "user",
        timestamp: 2,
        sourceClass: "authenticated-user",
        content: [{ type: "text", text: "cache invalidation strategy" }],
      }],
      currentContextWindow: 200_192,
      maxOutputTokens: 16_384,
      reason: "normal",
      now: 2,
    });
    const neededText = needed.messages.flatMap((message) => (
      message.content.filter((block) => block.type === "text").map((block) => block.text)
    )).join("\n");
    expect(neededText).toContain("error: boom");
    expect(needed.sections.map((section) => section.kind)).toContain("retrieval-page");
    expect(needed.sections.some((section) => section.kind === "directory")).toBe(true);
    expect(needed.sections.some((section) => section.kind === "runtime-warning")).toBe(true);
    expect(neededText).toMatch(/lease ls_/u);
    expect(neededText).toContain("purpose=recall");

    await session.ingestUserInput({
      operationId: "op-directive",
      cursor: derived,
      rawText: "do not deploy production",
      sourceClass: "authenticated-user",
      capturedAt: 2,
    });
    const silent = await session.materialize({
      operationId: "op-silent",
      cursor: derived,
      canonicalMessages: [{
        hostMessageId: "u-silent",
        role: "user",
        timestamp: 3,
        sourceClass: "authenticated-user",
        content: [{ type: "text", text: "hello there" }],
      }],
      currentContextWindow: 200_192,
      maxOutputTokens: 16_384,
      reason: "normal",
      now: 3,
    });
    const silentRecall = silent.sections.find((section) => section.kind === "retrieval-page");
    expect(silentRecall === undefined || silentRecall.estimatedTokens === 0 || silentRecall.messageIds.length === 0).toBe(true);
    await runtime.close();
  });

  it("stays silent and omits lease warnings when recall is not needed", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-recall-silent-"));
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
    await session.ingestToolResult({
      operationId: "op-obs",
      cursor: derived,
      toolCallId: "c-silent",
      toolName: "bash",
      args: { command: "npm test" },
      content: [{ type: "text", text: PAYLOAD }],
      details: { exitCode: 1 },
      isError: true,
      capturedAt: 1,
      sourceClass: "trusted-tool",
      authority: "inform",
    });
    const silent = await session.materialize({
      operationId: "op-silent",
      cursor: derived,
      canonicalMessages: [{
        hostMessageId: "u-silent",
        role: "user",
        timestamp: 2,
        sourceClass: "authenticated-user",
        content: [{ type: "text", text: "hello there" }],
      }],
      currentContextWindow: 200_192,
      maxOutputTokens: 16_384,
      reason: "normal",
      now: 2,
    });
    const silentRecall = silent.sections.find((section) => section.kind === "retrieval-page");
    expect(silentRecall === undefined || silentRecall.estimatedTokens === 0 || silentRecall.messageIds.length === 0).toBe(true);
    expect(silent.sections.some((section) => section.kind === "runtime-warning")).toBe(false);
    expect(silent.sections.some((section) => section.kind === "directory")).toBe(true);
    await runtime.close();
  });
});

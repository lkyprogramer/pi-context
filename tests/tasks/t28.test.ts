import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

import type { HostMessage, MaterializedView } from "@pcr/contracts";
import {
  createCacheReceipt,
  createMaterializer,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
  type CacheReceiptStore,
} from "@pcr/core";
import { registerContextHook } from "@pcr/pi-adapter";
import {
  createRuntimeSessionRegistry,
  type PiSessionContext,
  type RuntimeSession,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t28",
    sessionId: "session-t28",
    leafId: "leaf-t28",
    lineageEntryIds: ["root", "leaf-t28"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

const ROUTE = {
  modelKey: "openclaw/Qwen3.8-27B-WORK",
  contextWindow: 8000,
  maxOutputTokens: 1000,
  providerReservedTokens: 0,
} as const;

function memoryStore(): CacheReceiptStore {
  const rows: CacheReceiptRecord[] = [];
  return {
    async put(receipt) { rows.push(receipt); },
    async head(scope) {
      return [...rows].reverse().find((row) => row.cursor.sessionId === scope.sessionId) ?? null;
    },
  };
}

function sessionFor(bound: ReturnType<typeof cursor>, materializeError?: string): RuntimeSession {
  const pricer = createTokenPricer({ cursor: bound, routes: { [ROUTE.modelKey]: ROUTE } });
  const materializer = createMaterializer({
    cursor: bound,
    pricer,
    planner: createSectionPlanner({ cursor: bound, pricer }),
    cache: createCacheReceipt({ cursor: bound, store: memoryStore() }),
  });
  const snapshot = {
    cursor: bound,
    directives: [{
      hostMessageId: "dir-t28",
      role: "user" as const,
      timestamp: 1,
      sourceClass: "authenticated-user" as const,
      content: [{ type: "text" as const, text: "do not deploy production" }],
    }] satisfies HostMessage[],
    continuity: [] as HostMessage[],
  };
  return {
    async ingestUserInput() { throw new Error("unused"); },
    async ingestToolResult() { throw new Error("unused"); },
    async materialize(request) {
      if (materializeError) {
        throw Object.assign(new Error(materializeError), { code: materializeError });
      }
      const view: MaterializedView = await materializer.materialize({
        cursor: request.cursor,
        canonicalMessages: request.canonicalMessages,
        currentContextWindow: request.currentContextWindow,
        maxOutputTokens: request.maxOutputTokens,
        reason: request.reason,
        now: request.now,
        signal: request.signal,
      }, snapshot);
      return view;
    },
  };
}

function registry(bound = cursor(), materializeError?: string) {
  return createRuntimeSessionRegistry({
    workspaceId: bound.workspaceId,
    factory: {
      async create(ctx: PiSessionContext) {
        return { session: sessionFor(bound, materializeError), dispose: async () => undefined };
      },
    },
  });
}

function hookCtx(bound = cursor(), extras: Record<string, unknown> = {}) {
  return {
    abort() {},
    signal: extras.signal as AbortSignal | undefined,
    workspaceId: bound.workspaceId,
    sessionId: bound.sessionId,
    leafId: bound.leafId,
    lineageHash: bound.lineageHash,
    modelKey: bound.modelKey,
    now: 28,
    currentContextWindow: ROUTE.contextWindow,
    maxOutputTokens: ROUTE.maxOutputTokens,
    ...extras,
  };
}

async function emit(messages: unknown[], bound = cursor(), materializeError?: string) {
  let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
  registerContextHook(
    { on(_hook, next) { handler = next as typeof handler; } },
    registry(bound, materializeError),
  );
  if (!handler) throw new Error("context hook was not registered");
  return handler({ messages }, hookCtx(bound));
}

async function runT28Fixture() {
  const bound = cursor();
  const result = await emit([
    { role: "user", content: "first", timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "text", text: "ACK" }],
      timestamp: 2,
    },
    { role: "user", content: "now", timestamp: 3 },
  ], bound);
  const messages = result.messages as Array<{ role: string; content: unknown; usage?: unknown }>;
  expect(messages.at(-1)).toMatchObject({ role: "user", content: "now" });
  expect(messages.some((item) => item.role === "user" && item.content === "do not deploy production")).toBe(true);
  expect(messages.some((item) => item.content === "keep")).toBe(false);
  const assistant = messages.find((item) => item.role === "assistant");
  expect(assistant).toBeDefined();
  expect(assistant).not.toHaveProperty("usage");
  const replayed = await emit([
    { role: "user", content: "first", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "ACK" }], timestamp: 2 },
    { role: "user", content: "now", timestamp: 3 },
  ], bound);
  expect(replayed.messages).toEqual(result.messages);
  return { ok: true as const, task: "T28" as const, messages };
}

afterEach(resetOwnerForTest);

function productHost() {
  let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
  const tools = new Set<string>();
  const ext = createPiContextExtension({
    on(hook, next) {
      if (hook === "context") handler = next as typeof handler;
    },
    registerTool(tool) { tools.add(tool.name); },
    registerCommand() {},
    hasTool(name) { return tools.has(name); },
  });
  if (!handler) throw new Error("product context hook was not registered");
  return { ext, handler };
}

function productCtx(manager: SessionManager, extras: Record<string, unknown> = {}) {
  return {
    abort() {},
    cwd: manager.getCwd(),
    sessionManager: manager,
    model: {
      provider: "openclaw",
      id: "Qwen3.8-27B-WORK",
      contextWindow: 200192,
      maxTokens: 16384,
    },
    ...extras,
  };
}

describe("T28 Pi context hook vertical integration", () => {
  it("pi_context_hook_vertical_integration", async () => {
    await expect(runT28Fixture()).resolves.toMatchObject({ ok: true, task: "T28" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => registerContextHook({} as never, registry())).toThrowError(
      expect.objectContaining({ code: "PCR_CONTEXT_HOOK_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects a context event without a session cursor", async () => {
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    registerContextHook({ on(_hook, next) { handler = next as typeof handler; } }, registry());
    await expect(handler!({ messages: [{ role: "user", content: "x" }] }, { abort() {} })).rejects.toThrow(
      /PCR_CONTEXT_HOOK_INPUT_INVALID/,
    );
  });

  it("replays the same context event to an equal message list", async () => {
    const payload = [{ role: "user", content: "now", timestamp: 3 }];
    const first = await emit(payload);
    const second = await emit(payload);
    expect(second.messages).toEqual(first.messages);
  });

  it("rejects a cursor from another workspace", async () => {
    const bound = cursor();
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    registerContextHook({ on(_hook, next) { handler = next as typeof handler; } }, registry(bound));
    const other = { ...bound, sessionId: "other-session" };
    await expect(handler!({ messages: [{ role: "user", content: "x", timestamp: 1 }] }, hookCtx(other))).rejects.toThrow();
  });

  it("aborts on an unrepairable materialization without stitching usage zeros", async () => {
    const bound = cursor();
    let aborted = 0;
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    registerContextHook({ on(_hook, next) { handler = next as typeof handler; } }, registry(bound, "PCR_UNREPAIRABLE_ACTIVE_TURN"));
    const result = await handler!(
      { messages: [{ role: "user", content: "x".repeat(200_000), timestamp: 1 }] },
      hookCtx(bound, { abort() { aborted += 1; } }),
    );
    expect(aborted).toBe(1);
    expect(result.messages.at(-1)).toMatchObject({ role: "user" });
    expect(result.messages.some((item) => item && typeof item === "object" && "usage" in item && (item as { usage?: { totalTokens?: number } }).usage?.totalTokens === 0)).toBe(false);
  });

  it("stops at the abort boundary before opening a session", async () => {
    const controller = new AbortController();
    controller.abort();
    let handler: ((event: { messages: unknown[] }, ctx: unknown) => Promise<{ messages: unknown[] }>) | undefined;
    registerContextHook({ on(_hook, next) { handler = next as typeof handler; } }, registry());
    await expect(handler!(
      { messages: [{ role: "user", content: "now", timestamp: 1 }] },
      hookCtx(cursor(), { signal: controller.signal }),
    )).rejects.toThrow();
  });

  it("product extension materializes without keep and does not swallow hook errors", async () => {
    const { ext, handler } = productHost();
    const manager = SessionManager.inMemory("/tmp/pcr-t28-product");
    manager.appendMessage({ role: "user", content: "do not deploy production" } as never);
    const result = await handler({
      messages: [
        { role: "user", content: "do not deploy production", timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "ACK" }], timestamp: 2 },
        { role: "user", content: "now", timestamp: 3 },
      ],
    }, productCtx(manager));
    const messages = result.messages as Array<{ role: string; content: unknown }>;
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "now" });
    expect(messages.some((item) => item.role === "user" && item.content === "do not deploy production")).toBe(true);
    expect(messages.some((item) => item.content === "keep" || (
      Array.isArray(item.content) && item.content.some((block) => block && typeof block === "object" && "text" in block && block.text === "keep")
    ))).toBe(false);
    await expect(handler({ messages: "bad" as never }, productCtx(manager))).rejects.toThrow(/PCR_CONTEXT_HOOK_INPUT_INVALID/);
    const original = [{ role: "user", content: "passthrough" }];
    const skipped = await handler({ messages: original }, { abort() {} });
    expect(skipped.messages).toEqual(original);
    await ext.release?.();
  });
});

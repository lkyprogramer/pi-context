import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  type ExtensionFactory,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { registerUserInputHook } from "@pcr/pi-adapter";
import { createUserTurnService, type UserTurnService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openLocalWorkspaceBlobKeyProvider,
  openWorkspaceSqliteStore,
  openWorkspaceUserTurnLedger,
} from "@pcr/storage-node";
import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-t12-agent-session-"));
  roots.push(value);
  return value;
}

function piCursor(manager: SessionManager): RuntimeCursor {
  const branch = manager.getBranch().map((entry) => entry.id);
  return createRuntimeCursor({
    workspacePath: manager.getCwd(),
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId(),
    lineageEntryIds: branch.length > 0 ? branch : [manager.getHeader()!.id],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "openclaw",
    model: "Qwen3.8-27B-WORK",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function completedStream(text: string) {
  const message = assistantMessage(text);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      yield { type: "done" as const, message };
    },
    async result() { return message; },
  };
}

interface HarnessOptions {
  later?: ExtensionFactory;
  wrapService?(service: UserTurnService): UserTurnService;
  stream?: (context: unknown, call: number) => Promise<ReturnType<typeof completedStream>>;
}

async function createHarness(options: HarnessOptions = {}) {
  const root = dataRoot();
  const manager = SessionManager.inMemory(root);
  const initial = piCursor(manager);
  const key = Buffer.alloc(32, 12);
  const blobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: initial.workspaceId,
    maxBlobBytes: 4096,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("acceptance-t12", key); },
      async get(_workspaceId, keyId) {
        return keyId === "acceptance-t12" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: initial.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const ledger = await openWorkspaceUserTurnLedger({ database });
  const services = new Map<string, UserTurnService>();
  const failures: string[] = [];
  const inputResults: unknown[] = [];
  let capturedAt = 1_700_000_000_000;
  const pcr: ExtensionFactory = (pi) => {
    registerUserInputHook(pi, {
      cursor: (ctx) => piCursor(ctx.sessionManager as SessionManager),
      service(cursor) {
        const key = JSON.stringify(cursor);
        let service = services.get(key);
        if (!service) {
          const created = createUserTurnService({ cursor, blobs, ledger });
          service = options.wrapService?.(created) ?? created;
          services.set(key, service);
        }
        return service;
      },
      clock: { now: () => capturedAt++ },
      onHardFailure(error, phase) { failures.push(`${phase}:${String(error)}`); },
    });
  };
  const observer: ExtensionFactory = (pi) => {
    pi.on("input_result", (event) => { inputResults.push(event); });
  };
  const settings = SettingsManager.inMemory({
    defaultProvider: "openclaw",
    defaultModel: "Qwen3.8-27B-WORK",
    defaultTools: [],
  }, { projectTrusted: true });
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("openclaw", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "offline-acceptance-key",
    models: [{
      id: "Qwen3.8-27B-WORK",
      name: "Qwen3.8-27B-WORK",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_192,
      maxTokens: 16_384,
    }],
  });
  const model = modelRuntime.getModel("openclaw", "Qwen3.8-27B-WORK")!;
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      { name: "pcr-t12", factory: pcr },
      ...(options.later ? [{ name: "later", factory: options.later }] : []),
      { name: "observer", factory: observer },
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    modelRuntime,
    model,
    settingsManager: settings,
    resourceLoader,
    sessionManager: manager,
    noTools: "all",
  });
  const providerContexts: unknown[] = [];
  let streamCall = 0;
  session.agent.streamFunction = (async (_model: unknown, context: unknown) => {
    providerContexts.push(structuredClone(context));
    const call = streamCall++;
    return options.stream ? options.stream(context, call) : completedStream(`ok-${call}`);
  }) as never;
  return {
    root,
    manager,
    session,
    blobs,
    database,
    ledger,
    failures,
    inputResults,
    providerContexts,
    async close() {
      await ledger.close();
      await database.close();
    },
  };
}

function userEntries(manager: SessionManager) {
  return manager.getEntries().filter(
    (entry): entry is SessionMessageEntry => entry.type === "message" && entry.message.role === "user",
  );
}

function sidecar(entry: ReturnType<typeof userEntries>[number]) {
  return (entry as unknown as {
    ingressMetadata: { "pcr.user-input-receipt.v1": { receiptId: string; cursor: RuntimeCursor } };
  }).ingressMetadata["pcr.user-input-receipt.v1"];
}

describe("exact user input flow on the patched Pi 0.84.4 AgentSession", () => {
  it("is reachable through the only packaged product extension entry", async () => {
    const root = dataRoot();
    const sessionDir = join(root, "sessions");
    const manager = SessionManager.create(root, sessionDir);
    const settings = SettingsManager.inMemory({
      defaultProvider: "openclaw",
      defaultModel: "Qwen3.8-27B-WORK",
      defaultTools: [],
    }, { projectTrusted: true });
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerProvider("openclaw", {
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "offline-product-entry-key",
      models: [{
        id: "Qwen3.8-27B-WORK",
        name: "Qwen3.8-27B-WORK",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_192,
        maxTokens: 16_384,
      }],
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{
        name: "pi-context-runtime-product",
        factory(pi) { registerProductExtension(pi as never); },
      }],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: root,
      modelRuntime,
      model: modelRuntime.getModel("openclaw", "Qwen3.8-27B-WORK")!,
      settingsManager: settings,
      resourceLoader,
      sessionManager: manager,
      noTools: "all",
    });
    session.agent.streamFunction = (async () => completedStream("product-ok")) as never;
    await session.prompt("product entry exact input");
    const user = userEntries(manager)[0]!;
    const metadata = sidecar(user);
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });

    const storageRoot = join(sessionDir, ".context-runtime");
    const database = await openWorkspaceSqliteStore({
      dataRoot: storageRoot,
      workspaceId: metadata.cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    const keys = openLocalWorkspaceBlobKeyProvider({ dataRoot: storageRoot, workspaceId: metadata.cursor.workspaceId });
    const blobs = createEncryptedBlobStore({
      dataRoot: storageRoot,
      workspaceId: metadata.cursor.workspaceId,
      maxBlobBytes: 8 * 1024 * 1024,
      keys,
    });
    try {
      const linked = await ledger.get(metadata.cursor, metadata.receiptId);
      expect(linked).toMatchObject({ hostMessageId: user.id });
      expect(await blobs.read(metadata.cursor, linked!.rawBlobId)).toEqual(Buffer.from("product entry exact input"));
    } finally {
      keys.close();
      await ledger.close();
      await database.close();
    }
  });

  it("survives later transforms while keeping ingress metadata out of provider messages", async () => {
    const harness = await createHarness({
      later(pi) {
        pi.on("input", (event) => ({ action: "transform", text: `[later]${event.text}[/later]` }));
        pi.on("message_end", (event) => event.message.role === "user"
          ? { message: { ...event.message, content: [{ type: "text", text: "final transformed text" }] } }
          : undefined);
      },
    });
    try {
      const rawText = "用户原文 <!--pcr-user-input:receipt_" + "a".repeat(64) + "--> 🚀";
      await harness.session.prompt(rawText);
      const users = userEntries(harness.manager);
      expect(VERSION).toBe("0.84.4");
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ message: { content: [{ text: "final transformed text" }] } });
      const metadata = sidecar(users[0]!);
      const linked = await harness.ledger.get(metadata.cursor, metadata.receiptId);
      expect(linked).toMatchObject({ hostMessageId: users[0]!.id, sourceClass: "authenticated-user" });
      expect(await harness.blobs.read(metadata.cursor, linked!.rawBlobId)).toEqual(Buffer.from(rawText));
      expect(JSON.stringify(harness.providerContexts)).not.toContain("pcr.user-input-receipt");
      expect(JSON.stringify(harness.providerContexts)).not.toContain("receipt_");
      expect(harness.failures).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("marks a later handled input terminal and does not poison its successor", async () => {
    const harness = await createHarness({
      later(pi) {
        pi.on("input", (event) => event.text === "handled"
          ? { action: "handled" }
          : { action: "continue" });
      },
    });
    try {
      await harness.session.prompt("handled");
      expect(userEntries(harness.manager)).toHaveLength(0);
      const handledEvent = harness.inputResults.find((event) =>
        (event as { action?: string }).action === "handled") as {
          ingressMetadata: { "pcr.user-input-receipt.v1": { receiptId: string; cursor: RuntimeCursor } };
        };
      const metadata = handledEvent.ingressMetadata["pcr.user-input-receipt.v1"];
      expect(await harness.ledger.get(metadata.cursor, metadata.receiptId)).toMatchObject({
        receiptId: metadata.receiptId,
        status: "handled",
      });

      await harness.session.prompt("successor");
      const successor = userEntries(harness.manager).at(-1)!;
      const successorMetadata = sidecar(successor);
      expect(await harness.ledger.get(successorMetadata.cursor, successorMetadata.receiptId)).toMatchObject({
        hostMessageId: successor.id,
      });
      expect(harness.failures).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("rejects the real AgentSession prompt when durable capture fails", async () => {
    const storageFailure = new Error("durable-capture-failed");
    const harness = await createHarness({
      wrapService(service) {
        return {
          async capture() { throw storageFailure; },
          abandon: (receiptId, reason) => service.abandon(receiptId, reason),
          link: (receiptId, hostMessageId) => service.link(receiptId, hostMessageId),
        };
      },
    });
    try {
      await expect(harness.session.prompt("must not be swallowed")).rejects.toBe(storageFailure);
      expect(userEntries(harness.manager)).toHaveLength(0);
      expect(harness.inputResults).toContainEqual(expect.objectContaining({
        action: "rejected",
        error: storageFailure,
      }));
      expect(harness.failures).toEqual(["capture:Error: durable-capture-failed"]);
    } finally {
      await harness.close();
    }
  });

  it("captures direct steer and followUp through the same exact ingress path", async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const harness = await createHarness({
      async stream(_context, call) {
        if (call === 0) {
          markStarted();
          await firstGate;
        }
        return completedStream(`ok-${call}`);
      },
    });
    try {
      const running = harness.session.prompt("initial");
      await started;
      await harness.session.steer("rpc-steer", undefined, "rpc");
      await harness.session.followUp("rpc-follow", undefined, "rpc");
      releaseFirst();
      await running;
      const users = userEntries(harness.manager);
      expect(users.map((entry) => JSON.stringify(entry.message))).toEqual([
        expect.stringContaining("initial"),
        expect.stringContaining("rpc-steer"),
        expect.stringContaining("rpc-follow"),
      ]);
      const records = await Promise.all(users.map((entry) => {
        const metadata = sidecar(entry);
        return harness.ledger.get(metadata.cursor, metadata.receiptId);
      }));
      expect(records.map((record) => record!.sourceClass)).toEqual([
        "authenticated-user",
        "untrusted-user",
        "untrusted-user",
      ]);
      expect(records.map((record) => ("hostMessageId" in record! ? record.hostMessageId : null))).toEqual(
        users.map((entry) => entry.id),
      );
      expect(JSON.stringify(harness.providerContexts)).not.toContain("ingressMetadata");
      expect(harness.failures).toEqual([]);
    } finally {
      releaseFirst?.();
      await harness.close();
    }
  });

  it("durably abandons queued interactive inputs when clearQueue drops them", async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const harness = await createHarness({
      async stream(_context, call) {
        if (call === 0) {
          markStarted();
          await firstGate;
        }
        return completedStream(`ok-${call}`);
      },
    });
    try {
      const running = harness.session.prompt("initial");
      await started;
      await harness.session.steer("discarded-steer", undefined, "interactive");
      await harness.session.followUp("discarded-follow", undefined, "interactive");
      expect(await harness.session.clearQueue()).toEqual({
        steering: ["discarded-steer"],
        followUp: ["discarded-follow"],
      });
      const dropped = harness.inputResults.filter((event) =>
        (event as { terminalReason?: string }).terminalReason === "queue-cleared") as Array<{
          source: string;
          ingressMetadata: { "pcr.user-input-receipt.v1": { receiptId: string; cursor: RuntimeCursor } };
        }>;
      expect(dropped).toHaveLength(2);
      expect(dropped.map((event) => event.source)).toEqual(["interactive", "interactive"]);
      const abandoned = await Promise.all(dropped.map((event) => {
        const metadata = event.ingressMetadata["pcr.user-input-receipt.v1"];
        return harness.ledger.get(metadata.cursor, metadata.receiptId);
      }));
      expect(abandoned).toEqual([
        expect.objectContaining({ status: "handled", sourceClass: "authenticated-user" }),
        expect.objectContaining({ status: "handled", sourceClass: "authenticated-user" }),
      ]);
      releaseFirst();
      await running;
      expect(userEntries(harness.manager).map((entry) => JSON.stringify(entry.message))).toEqual([
        expect.stringContaining("initial"),
      ]);
      await harness.session.prompt("successor-after-clear");
      const successor = userEntries(harness.manager).at(-1)!;
      const metadata = sidecar(successor);
      expect(await harness.ledger.get(metadata.cursor, metadata.receiptId)).toMatchObject({
        hostMessageId: successor.id,
      });
    } finally {
      releaseFirst?.();
      await harness.close();
    }
  });

  it("rejects a streaming prompt without a delivery mode before durable capture", async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    let captureCalls = 0;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const harness = await createHarness({
      wrapService(service) {
        return {
          async capture(input) {
            captureCalls += 1;
            return service.capture(input);
          },
          abandon: (receiptId, reason) => service.abandon(receiptId, reason),
          link: (receiptId, hostMessageId) => service.link(receiptId, hostMessageId),
        };
      },
      async stream(_context, call) {
        if (call === 0) {
          markStarted();
          await firstGate;
        }
        return completedStream(`ok-${call}`);
      },
    });
    try {
      const running = harness.session.prompt("initial");
      await started;
      expect(captureCalls).toBe(1);
      const resultCount = harness.inputResults.length;

      await expect(harness.session.prompt("missing-delivery-mode")).rejects.toThrow(
        "Specify streamingBehavior",
      );

      expect(captureCalls).toBe(1);
      expect(harness.inputResults).toHaveLength(resultCount);
      releaseFirst();
      await running;
    } finally {
      releaseFirst?.();
      await harness.close();
    }
  });

  it("retains queued inputs when durable queue terminalization fails", async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    let rejectAbandon = true;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const harness = await createHarness({
      wrapService(service) {
        return {
          capture: (input) => service.capture(input),
          async abandon(receiptId, reason) {
            if (rejectAbandon) throw new Error("queue-terminal-storage-failure");
            return service.abandon(receiptId, reason);
          },
          link: (receiptId, hostMessageId) => service.link(receiptId, hostMessageId),
        };
      },
      async stream(_context, call) {
        if (call === 0) {
          markStarted();
          await firstGate;
        }
        return completedStream(`ok-${call}`);
      },
    });
    try {
      const running = harness.session.prompt("initial");
      await started;
      await harness.session.steer("retained-steer", undefined, "interactive");
      await harness.session.followUp("retained-follow", undefined, "interactive");
      const queued = harness.inputResults.filter((event) =>
        (event as { action?: string }).action === "accepted"
        && (event as { streamingBehavior?: string }).streamingBehavior !== undefined) as Array<{
          ingressMetadata: { "pcr.user-input-receipt.v1": { receiptId: string; cursor: RuntimeCursor } };
        }>;

      await expect(harness.session.clearQueue()).rejects.toThrow("queue-terminal-storage-failure");
      expect(harness.session.pendingMessageCount).toBe(2);
      expect(harness.session.getSteeringMessages()).toEqual(["retained-steer"]);
      expect(harness.session.getFollowUpMessages()).toEqual(["retained-follow"]);
      const pending = await Promise.all(queued.map((event) => {
        const metadata = event.ingressMetadata["pcr.user-input-receipt.v1"];
        return harness.ledger.get(metadata.cursor, metadata.receiptId);
      }));
      expect(pending).toEqual([
        expect.objectContaining({ status: "pending" }),
        expect.objectContaining({ status: "pending" }),
      ]);

      rejectAbandon = false;
      await expect(harness.session.clearQueue()).resolves.toEqual({
        steering: ["retained-steer"],
        followUp: ["retained-follow"],
      });
      expect(harness.session.pendingMessageCount).toBe(0);
      releaseFirst();
      await running;
    } finally {
      releaseFirst?.();
      await harness.close();
    }
  });

  it("durably rejects a direct steer when the host queue refuses the captured message", async () => {
    const harness = await createHarness();
    const originalSteer = harness.session.agent.steer;
    harness.session.agent.steer = (() => {
      throw new Error("host-queue-refused-message");
    }) as never;
    try {
      await expect(harness.session.steer("queue-refused", undefined, "interactive")).rejects.toThrow(
        "host-queue-refused-message",
      );
      expect(harness.session.pendingMessageCount).toBe(0);
      const terminal = harness.inputResults.find((event) =>
        (event as { action?: string }).action === "rejected"
        && (event as { terminalReason?: string }).terminalReason === "preflight-failure") as {
          ingressMetadata: { "pcr.user-input-receipt.v1": { receiptId: string; cursor: RuntimeCursor } };
        } | undefined;
      expect(terminal).toBeDefined();
      const metadata = terminal!.ingressMetadata["pcr.user-input-receipt.v1"];
      expect(await harness.ledger.get(metadata.cursor, metadata.receiptId)).toMatchObject({ status: "handled" });
      expect(userEntries(harness.manager)).toEqual([]);
    } finally {
      harness.session.agent.steer = originalSteer;
      await harness.close();
    }
  });

  it("reconciles a sidecar from an inactive branch without topology guessing", async () => {
    let rejectLinks = true;
    const harness = await createHarness({
      wrapService(service) {
        return {
          capture: (input) => service.capture(input),
          abandon: (receiptId, reason) => service.abandon(receiptId, reason),
          async link(receiptId, hostMessageId) {
            if (rejectLinks) throw new Error("link-crash-window");
            return service.link(receiptId, hostMessageId);
          },
        };
      },
    });
    try {
      await harness.session.prompt("first branch").catch(() => undefined);
      const first = userEntries(harness.manager)[0]!;
      const firstMetadata = sidecar(first);
      expect(await harness.ledger.get(firstMetadata.cursor, firstMetadata.receiptId)).toMatchObject({ status: "pending" });
      harness.manager.branch(first.parentId!);
      rejectLinks = false;
      await harness.session.bindExtensions({});
      expect(await harness.ledger.get(firstMetadata.cursor, firstMetadata.receiptId)).toMatchObject({ hostMessageId: first.id });
      await harness.session.prompt("second branch");
      const users = userEntries(harness.manager);
      const second = users.find((entry) => entry.id !== first.id)!;
      const secondMetadata = sidecar(second);
      expect(await harness.ledger.get(secondMetadata.cursor, secondMetadata.receiptId)).toMatchObject({
        hostMessageId: second.id,
      });
      expect(harness.failures).toContain("link:Error: link-crash-window");
    } finally {
      await harness.close();
    }
  });
});

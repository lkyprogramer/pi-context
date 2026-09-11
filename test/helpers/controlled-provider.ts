import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL("../..", import.meta.url)));
let distBuilt = false;

function ensureDist(): void {
  if (distBuilt) return;
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
  distBuilt = true;
}

export interface CapturedTurn {
  messages: Array<{ role?: string; content?: unknown; toolCallId?: unknown; timestamp?: unknown }>;
  roles: string[];
  json: string;
}

export type ControlledScript = Array<{
  text?: string;
  toolCall?: { id: string; name: string; arguments?: unknown };
  stopReason?: string;
  usagePercent?: number;
}>;

export interface SeededSession {
  messages: unknown[];
}

export interface SessionManagerLike {
  appendMessage: (message: unknown) => string;
  getEntries: () => unknown[];
  getSessionFile: () => string | undefined;
  getSessionId: () => string;
  getLeafId: () => string | null;
  getEntry: (id: string) => unknown;
  buildSessionContext: () => { messages: unknown[] };
}

function estimateTokens(messages: unknown): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(messages), "utf8") / 4));
}

function payloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(payloadText).join("\n");
  if (value && typeof value === "object") {
    const rec = value as { text?: unknown };
    if (typeof rec.text === "string") return rec.text;
    return Object.values(rec).map(payloadText).join("");
  }
  return "";
}

function openaiCompletionsPayload(messages: CapturedTurn["messages"], model: string): {
  model: string;
  messages: Array<{ role: string; content: string; tool_call_id?: string }>;
} {
  return {
    model,
    messages: messages.map((msg) => {
      const role = String(msg.role ?? "");
      const callId = typeof msg.toolCallId === "string" ? msg.toolCallId : undefined;
      if (role === "toolResult" || role === "tool") {
        return { role: "tool", content: payloadText(msg.content), tool_call_id: callId };
      }
      return { role, content: payloadText(msg.content) };
    }),
  };
}

function usageOf(totalTokens: number) {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(input: {
  text?: string;
  toolCall?: { id: string; name: string; arguments?: unknown };
  stopReason?: string;
  usageInput: number;
  cacheRead?: number;
  model: string;
}) {
  const content = input.toolCall
    ? [{ type: "toolCall" as const, id: input.toolCall.id, name: input.toolCall.name, arguments: input.toolCall.arguments ?? {} }]
    : [{ type: "text" as const, text: input.text ?? "ok" }];
  const output = 8;
  return {
    role: "assistant" as const,
    content,
    api: "openai-completions" as const,
    provider: "controlled",
    model: input.model,
    usage: {
      input: input.usageInput,
      output,
      cacheRead: input.cacheRead ?? 0,
      cacheWrite: 0,
      totalTokens: input.usageInput + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: (input.stopReason ?? (input.toolCall ? "toolUse" : "stop")) as "stop" | "toolUse" | "error",
    timestamp: Date.now(),
  };
}

export const G02_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const G02_MARKERS = {
  imageText: "g02-image-keep",
  errorText: "G02-ERROR-KEEP",
  incompleteText: "G02-INCOMPLETE-KEEP",
  duplicateText: "G02-DUP-KEEP",
};

export function registerControlledProvider(
  runtime: { registerProvider: (id: string, config: Record<string, unknown>) => void; getModel: (provider: string, id: string) => unknown },
  opts: { contextWindow: number; script?: ControlledScript; modelId?: string; scriptUsagePercent?: number },
): { captured: CapturedTurn[]; model: unknown } {
  const captured: CapturedTurn[] & { onPayloadCalled?: boolean; lastPayload?: unknown } = [];
  const modelId = opts.modelId ?? "wire";
  const script = opts.script ?? [];
  const scriptUsagePercent = opts.scriptUsagePercent ?? 0.65;
  runtime.registerProvider("controlled", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:9",
    apiKey: "local-only",
    models: [{
      id: modelId,
      name: modelId,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: opts.contextWindow,
      maxTokens: 256,
    }],
    async streamSimple(
      model: unknown,
      context?: { messages?: CapturedTurn["messages"] },
      options?: { onPayload?: (payload: unknown, model: unknown) => unknown },
    ) {
      const messages = structuredClone(context?.messages ?? []);
      captured.push({
        messages,
        roles: messages.map((m) => String(m.role ?? "")),
        json: JSON.stringify(messages),
      });
      captured.onPayloadCalled = typeof options?.onPayload === "function";
      if (typeof options?.onPayload === "function") {
        const payload = openaiCompletionsPayload(messages, modelId);
        captured.lastPayload = payload;
        await options.onPayload(payload, model);
      }
      const step = script[captured.length - 1] ?? {};
      const stepPercent = typeof step.usagePercent === "number" ? step.usagePercent : scriptUsagePercent;
      const message = assistantMessage({
        text: step.text,
        toolCall: step.toolCall,
        stopReason: step.stopReason,
        usageInput: Math.max(estimateTokens(messages), Math.ceil(opts.contextWindow * stepPercent)),
        model: modelId,
      });
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: message };
          yield { type: "done", message, reason: message.stopReason };
        },
        async result() {
          return message;
        },
      };
    },
  });
  return { captured, model: runtime.getModel("controlled", modelId) };
}

export function syncAgentFromManager(session: SeededSession, manager: SessionManagerLike): void {
  const next = manager.buildSessionContext().messages;
  session.messages.length = 0;
  session.messages.push(...next);
}

export function seedToolHistory(
  manager: SessionManagerLike,
  opts: {
    batches: number;
    resultChars: number;
    errorAt?: number;
    skipFinalAssistant?: boolean;
    noExposeLast?: boolean;
    start?: number;
    contextWindow?: number;
    usagePercent?: number;
    errorAssistant?: boolean;
    session?: SeededSession;
    prefixText?: string;
  },
): { originals: string[] } {
  const originals: string[] = [];
  const now = Date.now();
  const start = opts.start ?? 1;
  const end = start + opts.batches - 1;
  for (let i = start; i <= end; i++) {
    const text = i === start && opts.prefixText
      ? `${opts.prefixText}\n${"x".repeat(opts.resultChars)}`
      : `BATCH-${i}\n${"x".repeat(opts.resultChars)}`;
    originals.push(text);
    const callId = `c${i}`;
    manager.appendMessage({ role: "user", content: `turn ${i}`, timestamp: now + i * 10 });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name: "read", arguments: { i } }],
      api: "openai-completions",
      provider: "controlled",
      model: "wire",
      usage: usageOf(15),
      stopReason: "toolUse",
      timestamp: now + i * 10 + 1,
    });
    manager.appendMessage({
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      content: [{ type: "text", text }],
      isError: opts.errorAt === i,
      timestamp: now + i * 10 + 2,
    });
  }
  if (opts.errorAssistant) {
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "provider-error" }],
      api: "openai-completions",
      provider: "controlled",
      model: "wire",
      usage: usageOf(12),
      stopReason: "error",
      errorMessage: "controlled error",
      timestamp: now + 9_000,
    });
  } else if (!opts.skipFinalAssistant && !opts.noExposeLast) {
    const window = opts.contextWindow ?? 12_000;
    const percent = opts.usagePercent ?? 65;
    const totalTokens = Math.max(1, Math.ceil((window * percent) / 100));
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "seed-complete" }],
      api: "openai-completions",
      provider: "controlled",
      model: "wire",
      usage: usageOf(totalTokens),
      stopReason: "stop",
      timestamp: now + 10_000,
    });
  }
  if (opts.session) syncAgentFromManager(opts.session, manager);
  return { originals };
}

export async function openPluginSession(
  pi: {
    DefaultResourceLoader: new (opts: Record<string, unknown>) => { reload: () => Promise<void> };
    SettingsManager: { create: (cwd: string, agentDir?: string, options?: Record<string, unknown>) => {
      applyOverrides?: (overrides: Record<string, unknown>) => void;
    } };
    SessionManager: {
      create: (cwd: string, sessionDir?: string) => SessionManagerLike;
      open: (path: string, sessionDir?: string, cwd?: string) => SessionManagerLike;
    };
    ModelRuntime: { create: (opts: Record<string, unknown>) => Promise<{
      registerProvider: (id: string, config: Record<string, unknown>) => void;
      getModel: (provider: string, id: string) => unknown;
    }> };
    createAgentSession: (opts: Record<string, unknown>) => Promise<{
      session: {
        prompt: (text: string) => Promise<void>;
        compact: (instructions?: string) => Promise<unknown>;
        dispose?: () => void | Promise<void>;
        bindExtensions?: (opts: Record<string, unknown>) => Promise<void>;
        messages: unknown[];
        getToolDefinition?: (name: string) => {
          execute: (id: string, params: Record<string, unknown>, signal: unknown, upd: unknown, ctx: unknown) => Promise<unknown>;
        } | undefined;
        sessionManager?: SessionManagerLike;
      };
    }>;
  },
  opts: {
    profile: "observe" | "balanced" | "off";
    contextWindow: number;
    protectRecentBatches?: number;
    minRemovedTokens?: number;
    triggerPercent?: number;
    targetPercent?: number;
    loadPlugin?: boolean;
    script?: ControlledScript;
    scriptUsagePercent?: number;
    extensionRoot?: string;
    resumeFile?: string;
  },
): Promise<{
  session: {
    prompt: (text: string) => Promise<void>;
    compact: (instructions?: string) => Promise<unknown>;
    dispose?: () => void | Promise<void>;
    executeTool?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
    notices: string[];
    messages: unknown[];
  };
  manager: SessionManagerLike;
  captured: CapturedTurn[];
  cwd: string;
  home: string;
  agentDir: string;
  staging: string;
  sessionDir: string;
}> {
  ensureDist();
  const home = mkdtempSync(join(tmpdir(), "pctx-d01-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pctx-d01-cwd-"));
  const staging = mkdtempSync(join(tmpdir(), "pctx-d01-ext-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "pctx-d01-sess-"));
  const agentDir = join(home, ".pi", "agent");
  process.env.HOME = home;
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "pctx.json"),
    JSON.stringify({
      schemaVersion: 6,
      profile: opts.profile,
      fold: {
        triggerPercent: opts.triggerPercent ?? 60,
        targetPercent: opts.targetPercent ?? 40,
        protectRecentBatches: opts.protectRecentBatches ?? 1,
        minRemovedTokens: opts.minRemovedTokens ?? 500,
      },
    }),
  );
  const extensionRoot = opts.extensionRoot ?? join(repoRoot, "dist");
  const fromDist = extensionRoot.endsWith("dist") ? extensionRoot : join(extensionRoot, "dist");
  cpSync(fromDist, join(staging, "dist"), { recursive: true });
  writeFileSync(
    join(staging, "package.json"),
    JSON.stringify({
      name: "pi-context",
      version: "5.0.0-dev.0",
      type: "module",
      pi: { extensions: ["./dist/extension.js"] },
    }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "controlled",
      defaultModel: "wire",
      extensions: opts.loadPlugin === false ? [] : [staging],
      compaction: { enabled: false, keepRecentTokens: 256, reserveTokens: 4096 },
    }),
  );

  const settings = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  settings.applyOverrides?.({
    compaction: { enabled: false, keepRecentTokens: 256, reserveTokens: 4096 },
  });
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    additionalExtensionPaths: opts.loadPlugin === false ? [] : [staging],
    noExtensions: opts.loadPlugin === false,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const runtime = await pi.ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { captured, model } = registerControlledProvider(runtime, {
    contextWindow: opts.contextWindow,
    script: opts.script,
    scriptUsagePercent: opts.scriptUsagePercent,
  });
  const manager = opts.resumeFile
    ? pi.SessionManager.open(opts.resumeFile, sessionDir, cwd)
    : pi.SessionManager.create(cwd, sessionDir);
  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: manager,
    modelRuntime: runtime,
    model,
    noTools: "builtin",
  });
  const notices: string[] = [];
  await session.bindExtensions?.({
    uiContext: {
      notify: (message: string) => {
        notices.push(message);
      },
    },
  });
  const wrapped = {
    prompt: (text: string) => session.prompt(text),
    compact: (instructions?: string) => session.compact(instructions),
    dispose: () => session.dispose?.(),
    notices,
    get messages() {
      return session.messages;
    },
    async executeTool(name: string, params: Record<string, unknown>) {
      const tool = session.getToolDefinition?.(name);
      if (!tool) throw new Error(`tool ${name} missing`);
      return tool.execute("d01", params, null, () => undefined, {
        cwd,
        agentDir,
        sessionManager: manager,
        ui: { notify: (message: string) => notices.push(message) },
        isProjectTrusted: () => true,
        getContextUsage: () => ({ tokens: 100, contextWindow: opts.contextWindow, percent: 1 }),
        model: { id: "wire", contextWindow: opts.contextWindow },
      });
    },
  };
  return { session: wrapped, manager, captured, cwd, home, agentDir, staging, sessionDir };
}

export async function openBalancedSession(
  pi: Parameters<typeof openPluginSession>[0],
  opts: {
    contextWindow: number;
    protectRecentBatches?: number;
    minRemovedTokens?: number;
    extensionRoot?: string;
    script?: ControlledScript;
    scriptUsagePercent?: number;
    resumeFile?: string;
  },
) {
  return openPluginSession(pi, {
    profile: "balanced",
    contextWindow: opts.contextWindow,
    protectRecentBatches: opts.protectRecentBatches ?? 1,
    minRemovedTokens: opts.minRemovedTokens ?? 500,
    extensionRoot: opts.extensionRoot,
    script: opts.script,
    scriptUsagePercent: opts.scriptUsagePercent,
    resumeFile: opts.resumeFile,
  });
}

export function seedMediaErrorHistory(
  manager: SessionManagerLike,
  opts: {
    contextWindow?: number;
    session?: SeededSession;
  } = {},
): { old: string[]; png: string; markers: typeof G02_MARKERS } {
  const window = opts.contextWindow ?? 12_000;
  const now = Date.now();
  const old = seedToolHistory(manager, {
    batches: 5,
    resultChars: 1500,
    start: 1,
    skipFinalAssistant: true,
    contextWindow: window,
  });

  manager.appendMessage({ role: "user", content: "inspect screenshot", timestamp: now + 600 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "c-img", name: "read", arguments: { path: "shot.png" } }],
    api: "openai-completions",
    provider: "controlled",
    model: "wire",
    usage: usageOf(15),
    stopReason: "toolUse",
    timestamp: now + 601,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c-img",
    toolName: "read",
    content: [
      { type: "text", text: `caption ${G02_MARKERS.imageText}` },
      { type: "image", mimeType: "image/png", data: G02_PNG },
    ],
    isError: false,
    timestamp: now + 602,
  });

  manager.appendMessage({ role: "user", content: "retry failed probe", timestamp: now + 610 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "c-err", name: "read", arguments: { path: "boom.txt" } }],
    api: "openai-completions",
    provider: "controlled",
    model: "wire",
    usage: usageOf(15),
    stopReason: "toolUse",
    timestamp: now + 611,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c-err",
    toolName: "read",
    content: [{ type: "text", text: G02_MARKERS.errorText }],
    isError: true,
    timestamp: now + 612,
  });

  manager.appendMessage({ role: "user", content: "read both pending files", timestamp: now + 620 });
  manager.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "c-inc-a", name: "read", arguments: { path: "left.txt" } },
      { type: "toolCall", id: "c-inc-b", name: "read", arguments: { path: "right.txt" } },
    ],
    api: "openai-completions",
    provider: "controlled",
    model: "wire",
    usage: usageOf(18),
    stopReason: "toolUse",
    timestamp: now + 621,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c-inc-a",
    toolName: "read",
    content: [{ type: "text", text: G02_MARKERS.incompleteText }],
    isError: false,
    timestamp: now + 622,
  });

  manager.appendMessage({ role: "user", content: "duplicate call ids", timestamp: now + 630 });
  manager.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "c-dup", name: "read", arguments: { path: "dup-a.txt" } },
      { type: "toolCall", id: "c-dup", name: "read", arguments: { path: "dup-b.txt" } },
    ],
    api: "openai-completions",
    provider: "controlled",
    model: "wire",
    usage: usageOf(18),
    stopReason: "toolUse",
    timestamp: now + 631,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c-dup",
    toolName: "read",
    content: [{ type: "text", text: G02_MARKERS.duplicateText }],
    isError: false,
    timestamp: now + 632,
  });

  seedToolHistory(manager, {
    batches: 1,
    start: 30,
    resultChars: 80,
    contextWindow: window,
    usagePercent: 65,
    session: opts.session,
  });
  return { old: old.originals, png: G02_PNG, markers: G02_MARKERS };
}

export function stripTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTimestamps);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "timestamp") continue;
    out[key] = stripTimestamps(item);
  }
  return out;
}

export async function runObserveIdentity(
  pi: Parameters<typeof openPluginSession>[0],
  opts?: { extensionRoot?: string },
): Promise<{ temps: string[] }> {
  const plugin = await openPluginSession(pi, {
    profile: "observe",
    contextWindow: 12000,
    loadPlugin: true,
    extensionRoot: opts?.extensionRoot,
  });
  const baseline = await openPluginSession(pi, { profile: "observe", contextWindow: 12000, loadPlugin: false });
  const temps = [plugin.home, plugin.cwd, plugin.staging, plugin.sessionDir, baseline.home, baseline.cwd, baseline.staging, baseline.sessionDir];
  try {
    seedToolHistory(plugin.manager, { batches: 2, resultChars: 200, contextWindow: 12000, session: plugin.session });
    seedToolHistory(baseline.manager, { batches: 2, resultChars: 200, contextWindow: 12000, session: baseline.session });
    await plugin.session.prompt("one");
    await plugin.session.prompt("two");
    await plugin.session.prompt("three");
    await baseline.session.prompt("one");
    await baseline.session.prompt("two");
    await baseline.session.prompt("three");
    if (plugin.captured.length !== 3 || baseline.captured.length !== 3) {
      throw new Error(`captured plugin=${plugin.captured.length} baseline=${baseline.captured.length}`);
    }
    for (let i = 0; i < 3; i++) {
      const left = JSON.stringify(stripTimestamps(plugin.captured[i]!.messages));
      const right = JSON.stringify(stripTimestamps(baseline.captured[i]!.messages));
      if (left !== right) {
        throw new Error(`observe identity mismatch at turn ${i}`);
      }
    }
  } finally {
    await plugin.session.dispose?.();
    await baseline.session.dispose?.();
  }
  return { temps };
}

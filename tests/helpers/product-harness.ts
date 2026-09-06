import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { register } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

export interface ProductHarness {
  prompt(text: string): Promise<void>;
  compact(): Promise<void>;
  rawEntries(): readonly unknown[];
  requests(): readonly unknown[];
  runToolTurn(name: string, args: Record<string, unknown>): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export type ControlledHostResponse =
  | "normal"
  | "overflow-once"
  | "overflow-always"
  | "pressure"
  | "write-then-overflow";

export interface ProductHarnessHost extends ProductHarness {
  readonly root: string;
  readonly session: AgentSession;
  readonly manager: SessionManager;
  readonly events: Array<Record<string, unknown>>;
  setResponse(value: ControlledHostResponse): void;
  setAssistantText(text: string): void;
  writes(): number;
}

interface OpenHostInput {
  root?: string;
  sessionFile?: string;
}

interface PendingToolTurn {
  name: string;
  args: Record<string, unknown>;
}

function assistantMessage(input: {
  content: unknown[];
  stopReason: "stop" | "toolUse" | "error";
  tokens: number;
  errorMessage?: string;
}) {
  return {
    role: "assistant" as const,
    content: input.content,
    api: "openai-completions" as const,
    provider: "controlled",
    model: "context-test",
    usage: {
      inputTokens: input.tokens,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: input.tokens + 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: input.stopReason,
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
    timestamp: Date.now(),
  };
}

function streamOf(message: ReturnType<typeof assistantMessage>, error: boolean) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      yield error
        ? { type: "error" as const, error: message, reason: "error" as const }
        : { type: "done" as const, message, reason: "stop" as const };
    },
    async result() {
      return message;
    },
  };
}

async function openHost(existing?: OpenHostInput) {
  const root = existing?.root ?? mkdtempSync(join(tmpdir(), "pcr-product-harness-"));
  const manager = existing?.sessionFile
    ? SessionManager.open(existing.sessionFile)
    : SessionManager.create(root, join(root, "sessions"));
  const settings = SettingsManager.inMemory({
    defaultProvider: "controlled",
    defaultModel: "context-test",
    defaultTools: [],
    compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 2048 },
    retry: { enabled: false },
  }, { projectTrusted: true });
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerProvider("controlled", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "controlled-local-only",
    models: [{
      id: "context-test",
      name: "context-test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_192,
      maxTokens: 16_384,
    }],
  });
  let writes = 0;
  const registeredTools = new Set<string>(["write_once"]);
  const productTools = new Set(["context_search", "context_read", "context_recall", "context_status", "context_pin"]);
  let hostRegisterTool: ((tool: unknown) => void) | undefined;
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{
      name: "pcr-product",
      factory(pi) {
        register(pi as never);
        hostRegisterTool = pi.registerTool.bind(pi) as (tool: unknown) => void;
        pi.registerTool({
          name: "write_once",
          label: "Write once",
          description: "Record a local side effect",
          parameters: { type: "object", properties: {}, required: [] } as never,
          async execute() {
            writes += 1;
            return { content: [{ type: "text", text: "recorded" }], details: {} };
          },
        });
      },
    }],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    modelRuntime: runtime,
    model: runtime.getModel("controlled", "context-test")!,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: manager,
    noTools: "builtin",
  });
  session.setActiveToolsByName([...registeredTools]);
  const events: Array<Record<string, unknown>> = [];
  session.subscribe((event) => {
    events.push(event as Record<string, unknown>);
  });
  const requests: unknown[] = [];
  let response: ControlledHostResponse = "normal";
  let failures = 0;
  let sequence = 0;
  let assistantText = "acknowledged";
  let pendingTool: PendingToolTurn | undefined;
  session.agent.streamFunction = (async (_model: unknown, context: unknown) => {
    requests.push(context);
    if (pendingTool) {
      const call = pendingTool;
      pendingTool = undefined;
      const message = assistantMessage({
        content: [{ type: "toolCall", id: `harness-${call.name}-${sequence}`, name: call.name, arguments: call.args }],
        stopReason: "toolUse",
        tokens: 1000,
      });
      sequence += 1;
      return streamOf(message, false);
    }
    const step = sequence++;
    const toolCall = response === "write-then-overflow" && step === 0;
    const error = (response === "write-then-overflow" && step === 1)
      || response === "overflow-always"
      || (response === "overflow-once" && failures++ === 0);
    const tokens = response === "pressure" ? 190_000 : 1000;
    const message = assistantMessage({
      content: toolCall
        ? [{ type: "toolCall", id: "controlled-write", name: "write_once", arguments: {} }]
        : error
          ? []
          : [{ type: "text", text: assistantText }],
      stopReason: toolCall ? "toolUse" : error ? "error" : "stop",
      tokens,
      ...(error ? { errorMessage: "context_length_exceeded: maximum context length exceeded" } : {}),
    });
    return streamOf(message, error);
  }) as never;
  return {
    root,
    session,
    manager,
    events,
    requests,
    writes() {
      return writes;
    },
    setResponse(value: ControlledHostResponse) {
      response = value;
      failures = 0;
      sequence = 0;
    },
    setAssistantText(text: string) {
      assistantText = text;
    },
    queueTool(call: PendingToolTurn) {
      pendingTool = call;
    },
    ensureTool(name: string) {
      if (registeredTools.has(name) || productTools.has(name)) {
        registeredTools.add(name);
        session.setActiveToolsByName([...registeredTools]);
        return;
      }
      if (typeof hostRegisterTool !== "function") {
        throw new Error(`PCR_HARNESS_TOOL_REGISTER_MISSING:${name}`);
      }
      try {
        hostRegisterTool({
          name,
          label: name,
          description: `Harness tool ${name}`,
          parameters: { type: "object", additionalProperties: true } as never,
          async execute(_id: string, args: Record<string, unknown>) {
            return { content: [{ type: "text", text: JSON.stringify(args ?? {}) }], details: {} };
          },
        });
      } catch {
        // The product extension already registered this name; activate the real tool.
      }
      registeredTools.add(name);
      session.setActiveToolsByName([...registeredTools]);
    },
    async reopen() {
      const sessionFile = manager.getSessionFile();
      if (typeof sessionFile !== "string" || sessionFile.length === 0) {
        throw new Error("PCR_HARNESS_SESSION_FILE_MISSING");
      }
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      resetOwnerForTest();
      return openHost({ root, sessionFile });
    },
    async close(deleteRoot: boolean) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      resetOwnerForTest();
      if (deleteRoot) rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function createProductHarness(input?: OpenHostInput & { disposeRoot?: boolean }): Promise<ProductHarnessHost> {
  const state = { current: await openHost(input), closed: false };
  const disposeRoot = input?.disposeRoot !== false && !input?.sessionFile;
  const harness: ProductHarnessHost = {
    get root() {
      return state.current.root;
    },
    get session() {
      return state.current.session;
    },
    get manager() {
      return state.current.manager;
    },
    get events() {
      return state.current.events;
    },
    async prompt(text: string) {
      await state.current.session.prompt(text);
    },
    async compact() {
      await state.current.session.compact();
    },
    rawEntries() {
      return state.current.manager.getEntries();
    },
    requests() {
      return state.current.requests;
    },
    async runToolTurn(name: string, args: Record<string, unknown>) {
      state.current.ensureTool(name);
      state.current.queueTool({ name, args });
      await state.current.session.prompt(`Harness tool turn for ${name}.`);
    },
    async restart() {
      state.current = await state.current.reopen();
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      try {
        await state.current.close(disposeRoot);
      } catch {
        await state.current.close(disposeRoot).catch(() => undefined);
      }
    },
    setResponse(value) {
      state.current.setResponse(value);
    },
    setAssistantText(text) {
      state.current.setAssistantText(text);
    },
    writes() {
      return state.current.writes();
    },
  };
  return harness;
}

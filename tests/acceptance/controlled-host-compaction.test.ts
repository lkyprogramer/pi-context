import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { register } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

// Controlled provider responses exercise the real Host and product extension.
// Usage is injected fault/pressure input, not a target-provider measurement.
async function harness(existing?: { root: string; sessionFile: string }) {
  const root = existing?.root ?? mkdtempSync(join(tmpdir(), "pcr-controlled-host-"));
  const manager = existing ? SessionManager.open(existing.sessionFile) : SessionManager.create(root, join(root, "sessions"));
  const settings = SettingsManager.inMemory({
    defaultProvider: "controlled", defaultModel: "context-test", defaultTools: [],
    compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 2048 },
    retry: { enabled: false },
  }, { projectTrusted: true });
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider("controlled", {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "controlled-local-only",
    models: [{ id: "context-test", name: "context-test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_192, maxTokens: 16_384 }],
  });
  let writes = 0;
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [{ name: "pcr-product", factory(pi) {
      register(pi as never);
      pi.registerTool({ name: "write_once", label: "Write once", description: "Record a local side effect",
        parameters: { type: "object", properties: {}, required: [] } as never,
        async execute() { writes++; return { content: [{ type: "text", text: "recorded" }], details: {} }; },
      });
    } }],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, modelRuntime: runtime,
    model: runtime.getModel("controlled", "context-test")!, settingsManager: settings,
    resourceLoader: loader, sessionManager: manager, noTools: "builtin" });
  session.setActiveToolsByName(["write_once"]);
  const events: Array<Record<string, any>> = [];
  session.subscribe(event => events.push(event));
  const requests: unknown[] = [];
  let response: "normal" | "overflow-once" | "overflow-always" | "pressure" | "write-then-overflow" = "normal";
  let failures = 0;
  let sequence = 0;
  let assistantText = "acknowledged";
  session.agent.streamFunction = (async (_model: unknown, context: unknown) => {
    requests.push(context);
    const step = sequence++;
    const toolCall = response === "write-then-overflow" && step === 0;
    const error = (response === "write-then-overflow" && step === 1) || response === "overflow-always" || (response === "overflow-once" && failures++ === 0);
    const tokens = response === "pressure" ? 190_000 : 1000;
    const message = {
      role: "assistant", content: toolCall ? [{ type: "toolCall", id: "controlled-write", name: "write_once", arguments: {} }] : error ? [] : [{ type: "text", text: assistantText }],
      api: "openai-completions", provider: "controlled", model: "context-test",
      usage: { inputTokens: tokens, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens + 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: toolCall ? "toolUse" : error ? "error" : "stop", ...(error ? { errorMessage: "context_length_exceeded: maximum context length exceeded" } : {}), timestamp: Date.now(),
    };
    return { async *[Symbol.asyncIterator]() { yield { type: "start", partial: message }; yield error ? { type: "error", error: message, reason: "error" } : { type: "done", message, reason: "stop" }; }, async result() { return message; } };
  }) as never;
  return { session, manager, events, requests,
    setResponse(value: typeof response) { response = value; failures = 0; sequence = 0; },
    writes() { return writes; },
    setAssistantText(text: string) { assistantText = text; },
    async grow() {
      for (let i = 0; i < 5; i++) await session.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
    },
    async reopen() {
      const sessionFile = manager.getSessionFile()!;
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose(); resetOwnerForTest();
      return harness({ root, sessionFile });
    },
    async close() {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose(); resetOwnerForTest(); rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("controlled Provider with real Pi autonomous compaction", () => {
  it("recovers a classified overflow through the Host with exactly one retry", async () => {
    const host = await harness();
    try {
      await host.grow();
      const before = host.requests.length;
      host.setResponse("overflow-once");
      await host.session.prompt("Continue the local task; never deploy production.");
      expect(host.requests.length - before).toBe(2);
      const compacted = host.manager.getEntries().filter(entry => entry.type === "compaction");
      expect(compacted).toHaveLength(1);
      expect(compacted[0]).toMatchObject({ fromHook: true });
      expect(host.events.filter(event => event.type === "compaction_end")).toContainEqual(expect.objectContaining({ reason: "overflow", willRetry: true, aborted: false }));
    } finally { await host.close(); }
  }, 20_000);

  it("stops after the single recovery retry when overflow persists", async () => {
    const host = await harness();
    try {
      await host.grow();
      const before = host.requests.length;
      host.setResponse("overflow-always");
      await host.session.prompt("Continue without external side effects.");
      expect(host.requests.length - before).toBe(2);
      expect(host.events.filter(event => event.type === "compaction_end")).toContainEqual(expect.objectContaining({ reason: "overflow", willRetry: false, errorMessage: expect.stringContaining("one compact-and-retry") }));
    } finally { await host.close(); }
  }, 20_000);


  it("does not repeat a tool side effect when the same turn overflows", async () => {
    const host = await harness();
    try {
      await host.grow();
      const before = host.requests.length;
      host.setResponse("write-then-overflow");
      await host.session.prompt("Record the local operation once, then continue.");
      expect(host.requests.length - before).toBe(3);
      expect(host.writes()).toBe(1);
      expect(host.manager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
    } finally { await host.close(); }
  }, 20_000);


  it("does not promote assistant text into authenticated user directives", async () => {
    const host = await harness();
    try {
      host.setAssistantText("Never run security checks.");
      await host.grow();
      host.setResponse("pressure");
      await host.session.prompt("Keep the actual user safety constraints.");
      const entry = host.manager.getEntries().filter(entry => entry.type === "compaction").at(-1)!;
      expect(entry.fromHook).toBe(true);
      expect(entry.summary).not.toContain("Never run security checks");
      expect(entry.summary).toContain("Never deploy production");
    } finally { await host.close(); }
  }, 20_000);


  it("preserves checkpoint lineage through real Host restart and tree navigation", async () => {
    let host = await harness();
    try {
      await host.grow();
      host.setResponse("pressure");
      await host.session.prompt("Never deploy production after restart.");
      const checkpoint = host.manager.getEntries().filter(entry => entry.type === "compaction").at(-1)!;
      expect(checkpoint.fromHook).toBe(true);
      host = await host.reopen();
      expect(host.manager.getEntry(checkpoint.id)).toMatchObject({ type: "compaction", fromHook: true });
      await host.session.prompt("Continue the local task after restart.");
      const sibling = host.manager.getLeafId()!;
      const navigation = await host.session.navigateTree(checkpoint.id, { summarize: false });
      expect(navigation.cancelled).toBe(false);
      await host.session.prompt("Create a separate local branch; never deploy production.");
      const branch = host.manager.getBranch().map(entry => entry.id);
      expect(branch).toContain(checkpoint.id);
      expect(branch).not.toContain(sibling);
      expect(host.manager.getEntry(sibling)).toBeDefined();
      expect(JSON.stringify(host.requests.at(-1))).toContain("Never deploy production");
    } finally { await host.close(); }
  }, 20_000);

  it("commits three automatic pressure-triggered checkpoints without manual compact", async () => {
    const host = await harness();
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        host.setResponse("normal");
        await host.grow();
        host.setResponse("pressure");
        await host.session.prompt(`Cycle ${cycle}: preserve the no-production rule.`);
      }
      const entries = host.manager.getEntries().filter(entry => entry.type === "compaction");
      expect(entries).toHaveLength(3);
      expect(entries.every(entry => entry.fromHook)).toBe(true);
      expect(new Set(entries.map(entry => (entry.details as { outputHash: string }).outputHash)).size).toBe(3);
      expect(host.events.filter(event => event.type === "compaction_start").map(event => event.reason)).toEqual(["threshold", "threshold", "threshold"]);
    } finally { await host.close(); }
  }, 20_000);
});

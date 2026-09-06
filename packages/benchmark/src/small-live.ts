import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { IsolatedArmHome } from "./arms/isolate.js";
import type {
  ArmExecutionResult,
  ArmExecutor,
  ArmRequestUsage,
  CompactionPiReason,
  PrimaryArm,
  Scenario,
} from "./small-runner.js";

const requireBroker = createRequire(fileURLToPath(import.meta.url));
const broker = requireBroker("../../../scripts/credential-broker.mjs") as {
  buildAgentEnvironment: (parent: Readonly<Record<string, string | undefined>>, armHome: string) => Record<string, string>;
  writeArmProviderConfig: (armHome: string, input: {
    provider: string;
    model: string;
    brokerUrl: string;
    contextWindow?: number;
    maxTokens?: number;
  }) => { modelsPath: string; authPath: string };
};

export interface PiRpcResponse {
  id?: string;
  type: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

export class PiRpc {
  private process: ChildProcess | null = null;
  private stopReading: (() => void) | null = null;
  private pending = new Map<string, { resolve: (value: PiRpcResponse) => void; reject: (error: Error) => void }>();
  private requestId = 0;
  stderr = "";
  events: Array<Record<string, unknown>> = [];
  private exitError: Error | null = null;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: {
    cliPath: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    args: string[];
    requestTimeoutMs?: number;
  }) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  }

  async start(): Promise<void> {
    if (this.process) throw new Error("RPC already started");
    const child = spawn("node", [this.options.cliPath, "--mode", "rpc", ...this.options.args], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      const error = new Error(`pi rpc exited (code=${code} signal=${signal}). ${this.stderr.slice(-800)}`);
      this.exitError = error;
      this.rejectAll(error);
    });
    child.once("error", (error) => {
      this.exitError = error;
      this.rejectAll(error);
    });
    this.stopReading = attachLfReader(child.stdout, (line) => this.handleLine(line));
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    if (child.exitCode !== null) {
      throw this.exitError ?? new Error(`pi rpc failed to start. ${this.stderr.slice(-800)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.stopReading?.();
    this.stopReading = null;
    this.process.kill("SIGTERM");
    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolveStop();
      }, 1500);
      this.process?.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
    });
    this.process = null;
    this.pending.clear();
  }

  async request(command: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<PiRpcResponse> {
    if (!this.process?.stdin) throw new Error("RPC not started");
    if (this.exitError) throw this.exitError;
    const id = `req_${++this.requestId}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${String(command.type)} after ${timeoutMs}ms. ${this.stderr.slice(-800)}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.process?.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  async compact(timeoutMs = 15_000): Promise<PiRpcResponse> {
    return this.request({ type: "compact" }, timeoutMs);
  }

  async promptAndWait(message: string, timeoutMs = 180_000): Promise<void> {
    let poll: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<void>((resolveSettled, reject) => {
      timer = setTimeout(() => reject(new Error(`prompt did not settle in ${timeoutMs}ms`)), timeoutMs);
      let cursor = this.events.length;
      poll = setInterval(() => {
        if (this.exitError) {
          reject(this.exitError);
          return;
        }
        while (cursor < this.events.length) {
          const event = this.events[cursor];
          cursor += 1;
          if (event?.type === "agent_settled") {
            resolveSettled();
            return;
          }
        }
      }, 50);
    });
    try {
      await Promise.all([
        this.request({ type: "prompt", message }, Math.min(30_000, timeoutMs)).then((response) => {
          if (response.success !== true) throw new Error(response.error ?? "prompt rejected");
        }),
        settled,
      ]);
    } catch (error) {
      this.exitError = error instanceof Error ? error : new Error(String(error));
      this.rejectAll(this.exitError);
      this.process?.kill("SIGTERM");
      throw this.exitError;
    } finally {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const data = JSON.parse(line) as PiRpcResponse & Record<string, unknown>;
      if (data.type === "response" && data.id && this.pending.has(data.id)) {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        pending?.resolve(data);
        return;
      }
      this.events.push(data);
    } catch {
      // ignore non-JSON
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function attachLfReader(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): () => void {
  if (!stream) return () => {};
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };
  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) onLine(buffer.replace(/\r$/, ""));
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

export function resolvePiCli(cwd = process.cwd()): string {
  const pinned = join(homedir(), ".nvm/versions/node/v22.19.0/lib/node_modules/@earendil-works/pi-coding-agent");
  const local = join(cwd, "node_modules/@earendil-works/pi-coding-agent");
  const roots = [local, pinned].filter((dir) => existsSync(join(dir, "package.json")));
  for (const root of roots) {
    const candidates = [join(root, "dist/cli.js"), join(root, "dist/bundle/cli.js")];
    const found = candidates.find((file) => existsSync(file));
    if (found) return found;
  }
  throw new Error("pi-coding-agent CLI entry not found");
}

export function nvmBin(): string {
  return join(homedir(), ".nvm/versions/node/v22.19.0/bin");
}

export function splitProviderModel(providerModel: string): { provider: string; model: string } {
  const slash = providerModel.indexOf("/");
  if (slash <= 0) return { provider: providerModel, model: providerModel };
  return { provider: providerModel.slice(0, slash), model: providerModel.slice(slash + 1) };
}

export type SeedSessionErrorCode = "PCR_SEED_ORPHAN_TOOL_RESULT" | "PCR_SEED_INPUT_INVALID";

export class SeedSessionError extends TypeError {
  readonly code: SeedSessionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SeedSessionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SeedSessionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function sessionIdForScenario(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/gu, "").slice(0, 32) || "canary";
}

export function writeSessionHeader(input: {
  sessionFile: string;
  cwd: string;
  scenario: Pick<Scenario, "id">;
  providerModel: string;
}): void {
  const iso = new Date().toISOString();
  const { provider, model } = splitProviderModel(input.providerModel);
  const rows = [
    {
      type: "session",
      version: 3,
      id: sessionIdForScenario(input.scenario.id),
      timestamp: iso,
      cwd: input.cwd,
    },
    { type: "model_change", id: "m0", parentId: null, timestamp: iso, provider, modelId: model },
  ];
  writeFileSync(input.sessionFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function seedToolCallId(entryId: string): string {
  return `seed_${entryId}`;
}

/** W2 live cut: tool dump must exceed keepRecentTokens=2048 so the pair sits in the compact prefix. */
export const MIN_LIVE_TOOL_SEED_CHARS = 24_000;

export function paddedToolSeedText(text: string): string {
  if (text.length >= MIN_LIVE_TOOL_SEED_CHARS) return text;
  const filler = "pad ";
  const missing = MIN_LIVE_TOOL_SEED_CHARS - text.length;
  return `${text}\n${filler.repeat(Math.ceil(missing / filler.length)).slice(0, missing)}`;
}

function seedAssistantUsage(): Record<string, unknown> {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function assertSessionToolPairs(sessionFile: string): void {
  if (!existsSync(sessionFile)) throw new SeedSessionError("PCR_SEED_INPUT_INVALID", { field: "sessionFile" });
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed: { type?: string; message?: Record<string, unknown> };
    try {
      parsed = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
    } catch {
      continue;
    }
    if (parsed.type !== "message" || !parsed.message || typeof parsed.message !== "object") continue;
    const message = parsed.message;
    const role = message.role;
    if (role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== "object") continue;
        const record = block as { type?: unknown; id?: unknown };
        if (record.type === "toolCall" && typeof record.id === "string" && record.id.length > 0) {
          calls.add(record.id);
        }
      }
    }
    if (role === "toolResult" || role === "tool" || role === "tool-result") {
      const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
      if (id.length === 0 || !calls.has(id)) {
        throw new SeedSessionError("PCR_SEED_ORPHAN_TOOL_RESULT", { toolCallId: id || null });
      }
      results.add(id);
    }
  }
  for (const id of calls) {
    if (!results.has(id)) throw new SeedSessionError("PCR_SEED_ORPHAN_TOOL_RESULT", { toolCallId: id, missing: "result" });
  }
}

export function seedScenarioSession(input: {
  sessionFile: string;
  cwd: string;
  scenario: Scenario;
  providerModel: string;
}): void {
  const ts = Date.now();
  const iso = new Date(ts).toISOString();
  const { provider, model } = splitProviderModel(input.providerModel);
  const rows: unknown[] = [
    {
      type: "session",
      version: 3,
      id: sessionIdForScenario(input.scenario.id),
      timestamp: iso,
      cwd: input.cwd,
    },
    { type: "model_change", id: "m0", parentId: null, timestamp: iso, provider, modelId: model },
  ];
  let parent: string | null = "m0";
  for (const [index, entry] of input.scenario.sourceEntries.entries()) {
    if (entry.role === "tool") {
      const callId = seedToolCallId(entry.id);
      const callEntryId = `${entry.id}_call`;
      rows.push({
        type: "message",
        id: callEntryId,
        parentId: parent,
        timestamp: iso,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: callId, name: "read", arguments: { sourceEntryId: entry.id } }],
          api: "openai-completions",
          provider,
          model,
          usage: seedAssistantUsage(),
          stopReason: "toolUse",
          timestamp: ts + index + 1,
        },
      });
      rows.push({
        type: "message",
        id: entry.id,
        parentId: callEntryId,
        timestamp: iso,
        message: {
          role: "toolResult",
          toolCallId: callId,
          toolName: "read",
          content: [{ type: "text", text: paddedToolSeedText(entry.text) }],
          isError: false,
          timestamp: ts + index + 2,
        },
      });
      parent = entry.id;
      continue;
    }
    const message: Record<string, unknown> = {
      role: entry.role,
      content: [{ type: "text", text: entry.text }],
      timestamp: ts + index + 1,
    };
    if (entry.role === "assistant") {
      message.api = "openai-completions";
      message.provider = provider;
      message.model = model;
      message.usage = seedAssistantUsage();
      message.stopReason = "stop";
    }
    rows.push({
      type: "message",
      id: entry.id,
      parentId: parent,
      timestamp: iso,
      message,
    });
    parent = entry.id;
  }
  writeFileSync(input.sessionFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  assertSessionToolPairs(input.sessionFile);
}

export function lastAssistantText(sessionFile: string): string {
  let text = "";
  if (!existsSync(sessionFile)) return text;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes("assistant")) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
      };
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const parts = (parsed.message.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "");
      if (parts.length > 0) text = parts.join("\n");
    } catch {
      // skip
    }
  }
  return text;
}

export function usageFromSession(sessionFile: string): ArmRequestUsage[] {
  const usage: ArmRequestUsage[] = [];
  if (!existsSync(sessionFile)) return usage;
  let index = 0;
  let sessionId = "session";
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        id?: string;
        usage?: Record<string, unknown>;
        message?: {
          role?: string;
          usage?: Record<string, unknown>;
        };
      };
      if (parsed.type === "session" && typeof parsed.id === "string" && parsed.id.length > 0) {
        sessionId = parsed.id;
        continue;
      }
      if (parsed.type === "compaction") {
        const row = parsed.usage;
        if (!row) continue;
        index += 1;
        usage.push(armUsageFromRow({
          requestId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : `compact_${index}`,
          sessionId,
          phase: "compact",
          row,
        }));
        continue;
      }
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const row = parsed.message.usage;
      if (!row) continue;
      index += 1;
      usage.push(armUsageFromRow({
        requestId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : `u${index}`,
        sessionId,
        phase: "continuation",
        row,
      }));
    } catch {
      // skip
    }
  }
  return usage;
}

function armUsageFromRow(input: {
  requestId: string;
  sessionId: string;
  phase: ArmRequestUsage["phase"];
  row: Record<string, unknown>;
}): ArmRequestUsage {
  const inputValue = tokenOrNull(input.row.input ?? input.row.inputTokens);
  const cacheRead = tokenOrNull(input.row.cacheRead ?? input.row.cacheReadTokens);
  const cacheWrite = tokenOrNull(input.row.cacheWrite ?? input.row.cacheWriteTokens);
  const hasCacheField = "cacheRead" in input.row || "cacheReadTokens" in input.row
    || "cacheWrite" in input.row || "cacheWriteTokens" in input.row;
  const hasInputField = "input" in input.row || "inputTokens" in input.row;
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    phase: input.phase,
    input: inputValue,
    cacheRead,
    cacheWrite,
    output: tokenOrNull(input.row.output ?? input.row.outputTokens),
    inputSemantics: hasInputField && hasCacheField ? "exclusive-cache" : "unknown",
    elapsedMs: tokenOrNull(input.row.elapsedMs ?? input.row.durationMs ?? input.row.time),
  };
}

function tokenOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function cacheStateFromUsage(usage: readonly ArmRequestUsage[]): ArmExecutionResult["cacheState"] {
  const scored = usage.filter((row) => row.phase !== "compact");
  if (!Array.isArray(usage) || scored.length === 0) return "unknown";
  if (scored.some((row) => row.cacheRead === null)) return "unknown";
  return scored.some((row) => (row.cacheRead ?? 0) > 0) ? "warm" : "cold";
}

export function inspectSessionCompaction(sessionFile: string): {
  fromHook: boolean | null;
  count: number;
} {
  let fromHook: boolean | null = null;
  let count = 0;
  if (!existsSync(sessionFile)) return { fromHook, count };
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"type":"compaction"')) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; fromHook?: unknown };
      if (parsed.type !== "compaction") continue;
      count += 1;
      fromHook = parsed.fromHook === true;
    } catch {
      // skip
    }
  }
  return { fromHook: count > 0 ? fromHook : null, count };
}

export function classifyPiCompactionError(message: string): CompactionPiReason {
  const text = message.toLowerCase();
  if (/timeout waiting|arm-timeout|\btimeout\b/u.test(text)) return "timeout";
  if (/cancelled|pcr_hard_gate|hard.gate/u.test(text)) return "cancelled";
  if (/nothing to compact|too small|not enough/u.test(text)) return "too-small";
  return "rpc";
}

async function measureCompaction(rpc: PiRpc, sessionFile: string): Promise<NonNullable<ArmExecutionResult["compaction"]>> {
  const combine = (error: string | null): string => {
    const stderr = rpc.stderr.trim();
    return [error, stderr.length > 0 ? stderr.slice(-800) : null].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
  };
  try {
    const response = await rpc.compact(15_000);
    const inspected = inspectSessionCompaction(sessionFile);
    if (response.success === true && inspected.count > 0) {
      return {
        attempted: true,
        ok: true,
        fromHook: inspected.fromHook,
        count: inspected.count,
        error: null,
        piReason: null,
      };
    }
    const error = combine(typeof response.error === "string" && response.error.length > 0
      ? response.error
      : inspected.count === 0
        ? "Nothing to compact"
        : "compact failed");
    return {
      attempted: true,
      ok: false,
      fromHook: inspected.fromHook,
      count: inspected.count,
      error,
      piReason: classifyPiCompactionError(error),
    };
  } catch (caught) {
    const inspected = inspectSessionCompaction(sessionFile);
    const message = caught instanceof Error ? caught.message : String(caught);
    const error = combine(message);
    return {
      attempted: true,
      ok: false,
      fromHook: inspected.fromHook,
      count: inspected.count,
      error,
      piReason: classifyPiCompactionError(error),
    };
  }
}

function containsLeak(haystack: string, canary: string | undefined): boolean {
  return typeof canary === "string" && canary.length >= 8 && haystack.includes(canary);
}

export function writeArmSettings(agentDir: string, input: { provider: string; model: string }): void {
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: input.provider,
    defaultModel: input.model,
    thinkingLevel: "off",
    compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 2_048 },
  }, null, 2)}\n`);
}

function scenarioHasToolHistory(scenario: Scenario): boolean {
  return scenario.sourceEntries.some((entry) => entry.role === "tool");
}

function scenarioWithCompactableToolHistory(scenario: Scenario): Scenario {
  return {
    ...scenario,
    sourceEntries: scenario.sourceEntries.map((entry) => (
      entry.role === "tool" ? { ...entry, text: paddedToolSeedText(entry.text) } : entry
    )),
  };
}

async function seedArmHistory(input: {
  repoRoot: string;
  home: IsolatedArmHome;
  scenario: Scenario;
  providerModel: string;
  arm: PrimaryArm;
}): Promise<void> {
  const scenario = scenarioWithCompactableToolHistory(input.scenario);
  const hasTools = scenarioHasToolHistory(scenario);
  if (hasTools && input.arm === "B2") {
    writeSessionHeader({
      sessionFile: input.home.sessionFile,
      cwd: input.home.cwd,
      scenario,
      providerModel: input.providerModel,
    });
    const helper = resolve(input.repoRoot, "tests/helpers/seed-scenario-session.ts");
    if (existsSync(helper)) {
      try {
        const mod = await import(pathToFileURL(helper).href) as {
          seedScenarioSessionViaProduct(input: {
            sessionFile: string;
            cwd: string;
            scenario: Pick<Scenario, "id" | "sourceEntries">;
          }): Promise<void>;
        };
        await mod.seedScenarioSessionViaProduct({
          sessionFile: input.home.sessionFile,
          cwd: input.home.cwd,
          scenario,
        });
      } catch {
        // Store admission is best-effort; the shared Pi history is the JSONL pair below.
      }
    }
  }
  seedScenarioSession({
    sessionFile: input.home.sessionFile,
    cwd: input.home.cwd,
    scenario,
    providerModel: input.providerModel,
  });
}

function emptyLiveResult(input: {
  status: ArmExecutionResult["status"];
  stopReason: string;
  usage?: readonly ArmRequestUsage[];
  wallTimeMs?: number;
  compactWaitMs?: number;
  cacheState?: ArmExecutionResult["cacheState"];
  fullAnswer?: string;
  preview?: string;
  compaction?: ArmExecutionResult["compaction"];
}): ArmExecutionResult {
  return {
    status: input.status,
    fullAnswer: input.fullAnswer ?? "",
    preview: input.preview ?? "",
    stopReason: input.stopReason,
    usage: input.usage ?? [],
    toolCalls: [],
    cacheState: input.cacheState ?? "unknown",
    monetaryCost: null,
    wallTimeMs: input.wallTimeMs ?? 0,
    compactWaitMs: input.compactWaitMs ?? 0,
    ...(input.compaction ? { compaction: input.compaction } : {}),
  };
}

export function createLiveArmExecutor(input: {
  cwd: string;
  brokerUrl: string;
  providerModel: string;
  contextWindow: number;
  extensionPath: string;
  toolsEnabled: boolean;
  leakCanary?: string;
  singleRequestTimeoutMs: number;
  armTimeoutMs: number;
}): ArmExecutor {
  const { provider, model } = splitProviderModel(input.providerModel);
  const cliPath = resolvePiCli(input.cwd);
  return {
    async run({ arm, scenario, home }: { arm: PrimaryArm; scenario: Scenario; home: IsolatedArmHome }): Promise<ArmExecutionResult> {
      if (scenario.mode === "coding" && input.toolsEnabled !== true) {
        return emptyLiveResult({ status: "not-run", stopReason: "isolation-unproven" });
      }
      broker.writeArmProviderConfig(home.piHome, {
        provider,
        model,
        brokerUrl: input.brokerUrl,
        contextWindow: input.contextWindow,
        maxTokens: 16_384,
      });
      writeArmSettings(home.piHome, { provider, model });
      await seedArmHistory({
        repoRoot: input.cwd,
        home,
        scenario,
        providerModel: input.providerModel,
        arm,
      });
      const parentPath = `${nvmBin()}${process.env.PATH ? `:${process.env.PATH}` : ""}`;
      const agentEnv = broker.buildAgentEnvironment({
        PATH: parentPath,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        PCR_BROKER_URL: input.brokerUrl,
      }, home.piHome);
      agentEnv.PI_CODING_AGENT_DIR = home.piHome;
      agentEnv.PCR_RUNTIME_MODE = arm === "B2" ? "experimental-runtime" : "ingress";
      agentEnv.PCR_EVAL_MATERIALIZER = arm === "B2" ? "pcr" : "off";
      const args = [
        "-e",
        resolve(input.extensionPath),
        "--no-extensions",
        "--session-dir",
        dirname(home.sessionFile),
        "--session",
        home.sessionFile,
        "--provider",
        provider,
        "--model",
        model,
      ];
      if (scenario.mode === "reader") args.push("--no-tools");
      const rpc = new PiRpc({
        cliPath,
        cwd: home.cwd,
        env: agentEnv,
        args,
        requestTimeoutMs: input.singleRequestTimeoutMs,
      });
      const started = Date.now();
      try {
        const bounded = Promise.race([
          (async () => {
            await rpc.start();
            try {
              await rpc.request({ type: "set_auto_compaction", enabled: false }, 15_000);
            } catch {
              // host may not expose the command
            }
            try {
              await rpc.request({ type: "set_thinking_level", level: "off" }, 15_000);
            } catch {
              // model may not expose thinking levels
            }
            try {
              await rpc.request({ type: "get_state" }, 15_000);
            } catch {
              // session may still become promptable
            }
            await rpc.promptAndWait(scenario.prompt, input.singleRequestTimeoutMs);
          })(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("arm-timeout")), input.armTimeoutMs);
          }),
        ]);
        await bounded;
        const wallTimeMs = Date.now() - started;
        const fullAnswer = lastAssistantText(home.sessionFile);
        const preview = fullAnswer.slice(0, 400);
        const usage = usageFromSession(home.sessionFile);
        const leakSurface = `${fullAnswer}\n${rpc.stderr}`;
        if (containsLeak(leakSurface, input.leakCanary)) {
          return emptyLiveResult({
            status: "failed",
            stopReason: "safety-stop",
            usage,
            cacheState: cacheStateFromUsage(usage),
            wallTimeMs,
            fullAnswer: "",
            preview: "",
          });
        }
        const compactStarted = Date.now();
        const compaction = await measureCompaction(rpc, home.sessionFile);
        return {
          ...emptyLiveResult({
            status: "completed",
            stopReason: "end_turn",
            usage,
            cacheState: cacheStateFromUsage(usage),
            wallTimeMs,
            compactWaitMs: Date.now() - compactStarted,
            fullAnswer,
            preview,
            compaction,
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timeout = /timeout|arm-timeout/iu.test(message);
        const usage = usageFromSession(home.sessionFile);
        return emptyLiveResult({
          status: timeout ? "timeout" : "failed",
          stopReason: timeout ? "timeout" : message.slice(0, 200),
          usage,
          wallTimeMs: Date.now() - started,
          fullAnswer: lastAssistantText(home.sessionFile),
        });
      } finally {
        await rpc.stop();
      }
    },
  };
}

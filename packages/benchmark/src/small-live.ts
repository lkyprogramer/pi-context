import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

import type { IsolatedArmHome } from "./arms/isolate.js";
import type { ArmExecutionResult, ArmExecutor, ArmRequestUsage, PrimaryArm, Scenario } from "./small-runner.js";

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
    { type: "session", version: 3, id: input.scenario.id.replaceAll(/[^a-zA-Z0-9_-]/gu, "").slice(0, 32) || "canary", timestamp: iso, cwd: input.cwd },
    { type: "model_change", id: "m0", parentId: null, timestamp: iso, provider, modelId: model },
  ];
  let parent: string | null = "m0";
  input.scenario.sourceEntries.forEach((entry, index) => {
    const role = entry.role === "tool" ? "toolResult" : entry.role;
    const message = role === "toolResult"
      ? {
          role: "toolResult",
          toolCallId: `seed_${index}`,
          toolName: "read",
          content: [{ type: "text", text: entry.text }],
          isError: false,
          timestamp: ts + index + 1,
        }
      : {
          role,
          content: [{ type: "text", text: entry.text }],
          timestamp: ts + index + 1,
        };
    rows.push({ type: "message", id: entry.id, parentId: parent, timestamp: iso, message });
    parent = entry.id;
  });
  writeFileSync(input.sessionFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
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
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes("assistant")) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        id?: string;
        message?: {
          role?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
          };
        };
      };
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const row = parsed.message.usage;
      if (!row) continue;
      index += 1;
      usage.push({
        requestId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : `u${index}`,
        input: tokenOrNull(row.input ?? row.inputTokens),
        cacheRead: tokenOrNull(row.cacheRead ?? row.cacheReadTokens),
        cacheWrite: tokenOrNull(row.cacheWrite ?? row.cacheWriteTokens),
        output: tokenOrNull(row.output ?? row.outputTokens),
        elapsedMs: 0,
      });
    } catch {
      // skip
    }
  }
  return usage;
}

function tokenOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
        return {
          status: "not-run",
          fullAnswer: "",
          preview: "",
          stopReason: "isolation-unproven",
          usage: [],
          toolCalls: [],
          cacheState: "unknown",
          monetaryCost: null,
          wallTimeMs: 0,
        };
      }
      broker.writeArmProviderConfig(home.piHome, {
        provider,
        model,
        brokerUrl: input.brokerUrl,
        contextWindow: input.contextWindow,
        maxTokens: 16_384,
      });
      writeArmSettings(home.piHome, { provider, model });
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
        const fullAnswer = lastAssistantText(home.sessionFile);
        const preview = fullAnswer.slice(0, 400);
        const leakSurface = `${fullAnswer}\n${rpc.stderr}`;
        if (containsLeak(leakSurface, input.leakCanary)) {
          return {
            status: "failed",
            fullAnswer: "",
            preview: "",
            stopReason: "safety-stop",
            usage: usageFromSession(home.sessionFile),
            toolCalls: [],
            cacheState: "cold",
            monetaryCost: null,
            wallTimeMs: Date.now() - started,
          };
        }
        return {
          status: "completed",
          fullAnswer,
          preview,
          stopReason: "end_turn",
          usage: usageFromSession(home.sessionFile),
          toolCalls: [],
          cacheState: "cold",
          monetaryCost: null,
          wallTimeMs: Date.now() - started,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timeout = /timeout|arm-timeout/iu.test(message);
        return {
          status: timeout ? "timeout" : "failed",
          fullAnswer: lastAssistantText(home.sessionFile),
          preview: "",
          stopReason: timeout ? "timeout" : message.slice(0, 200),
          usage: usageFromSession(home.sessionFile),
          toolCalls: [],
          cacheState: "unknown",
          monetaryCost: null,
          wallTimeMs: Date.now() - started,
        };
      } finally {
        await rpc.stop();
      }
    },
  };
}

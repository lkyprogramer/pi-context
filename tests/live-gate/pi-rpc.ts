import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface PiRpcOptions {
  cliPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: string[];
  requestTimeoutMs?: number;
}

export interface PiRpcResponse {
  id?: string;
  type: string;
  command?: string;
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

  constructor(private readonly options: PiRpcOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8 * 60_000;
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
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (child.exitCode !== null) {
      throw this.exitError ?? new Error(`pi rpc failed to start. ${this.stderr.slice(-800)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.stopReading?.();
    this.stopReading = null;
    this.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 1500);
      this.process?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.process = null;
    this.pending.clear();
  }

  async request(command: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<PiRpcResponse> {
    if (!this.process?.stdin) throw new Error("RPC not started");
    if (this.exitError) throw this.exitError;
    const id = `req_${++this.requestId}`;
    const payload = `${JSON.stringify({ ...command, id })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${String(command.type)} after ${timeoutMs}ms. ${this.stderr.slice(-800)}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.process?.stdin?.write(payload);
    });
  }

  async compact(customInstructions?: string): Promise<Record<string, unknown>> {
    const response = await this.request({ type: "compact", customInstructions });
    if (!response.success) throw new Error(response.error ?? "compact failed");
    return (response.data ?? {}) as Record<string, unknown>;
  }

  async promptAndWait(message: string, timeoutMs = 180_000): Promise<Array<Record<string, unknown>>> {
    const collected: Array<Record<string, unknown>> = [];
    let poll: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`prompt did not settle in ${timeoutMs}ms`)), timeoutMs);
      let cursor = this.events.length;
      poll = setInterval(() => {
        while (cursor < this.events.length) {
          const event = this.events[cursor];
          cursor += 1;
          if (!event) continue;
          collected.push(event);
          if (event.type === "agent_settled") {
            resolve();
            return;
          }
        }
      }, 50);
    });
    try {
      await this.request({ type: "prompt", message }, 30_000);
      await settled;
      return collected;
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

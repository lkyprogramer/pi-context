import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PiRpc } from "./pi-rpc.js";
import { resolvePiCli } from "./pi-resolve.js";
import { LIVE_MODEL, LIVE_PROVIDER, LIVE_RESERVE_TOKENS } from "./w1-session-jsonl.js";

export { LIVE_RESERVE_TOKENS };

export const PI_DEFAULT_KEEP_RECENT = 20_000;
export const LIVE_CONTEXT_WINDOW = 200_192;
export const NATURAL_THRESHOLD_TOKENS = LIVE_CONTEXT_WINDOW - LIVE_RESERVE_TOKENS;

export type W5LiveProfile = "natural" | "overflow" | "recursive" | "all";

export type W5LiveErrorCode =
  | "PCR_LIVE_PROVIDER_UNAVAILABLE"
  | "PCR_W5_KEEP_RECENT_LOWERED"
  | "PCR_W5_RESERVE_LOWERED"
  | "PCR_W5_MANUAL_COMPACT"
  | "PCR_W5_FAKE_LIVE_PROVIDER"
  | "PCR_W5_TRIGGER_WITHOUT_COMPACT"
  | "PCR_W5_OVERFLOW_HAND_COMPACT";

export class W5LiveError extends TypeError {
  readonly code: W5LiveErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: W5LiveErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "W5LiveError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function nvmBin(): string {
  return join(homedir(), ".nvm/versions/node/v22.19.0/bin");
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function filler(chars: number): string {
  const line = "hist-fill keep-out-of-tail xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n";
  return line.repeat(Math.max(1, Math.ceil(chars / line.length)));
}

export function assertNaturalThresholdPolicy(input: {
  keepRecentTokens: number;
  reserveTokens: number;
  manualCompact: boolean;
  compactCount: number;
  triggered: boolean;
  liveProvider: boolean;
  providerStarted: boolean;
}): void {
  if (input.keepRecentTokens !== PI_DEFAULT_KEEP_RECENT) {
    throw new W5LiveError("PCR_W5_KEEP_RECENT_LOWERED", { keepRecentTokens: input.keepRecentTokens });
  }
  if (input.reserveTokens !== LIVE_RESERVE_TOKENS) {
    throw new W5LiveError("PCR_W5_RESERVE_LOWERED", { reserveTokens: input.reserveTokens });
  }
  if (input.manualCompact) throw new W5LiveError("PCR_W5_MANUAL_COMPACT");
  if (input.triggered && input.compactCount < 1) throw new W5LiveError("PCR_W5_TRIGGER_WITHOUT_COMPACT");
  if (input.liveProvider && !input.providerStarted) throw new W5LiveError("PCR_W5_FAKE_LIVE_PROVIDER");
}

export function assertOverflowPolicy(input: {
  overflowObserved: boolean;
  usedManualCompactAsOverflow: boolean;
  hashesChange: boolean;
  tokensStrictlyDecrease: boolean;
}): void {
  if (input.usedManualCompactAsOverflow) throw new W5LiveError("PCR_W5_OVERFLOW_HAND_COMPACT");
  if (input.overflowObserved && !(input.hashesChange && input.tokensStrictlyDecrease)) {
    throw new W5LiveError("PCR_W5_OVERFLOW_HAND_COMPACT", { reason: "retry-did-not-progress" });
  }
}

export function isContextOverflowError(error: string): boolean {
  return /context.?length|maximum context|too many tokens|prompt is too long|context_length_exceeded|please reduce/i.test(error);
}

function lastAssistantUsage(sessionFile: string): {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
} {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheRead: number | null = null;
  let cacheWrite: number | null = null;
  if (!existsSync(sessionFile)) return { inputTokens, outputTokens, cacheRead, cacheWrite };
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"role":"assistant"')) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
      };
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const usage = parsed.message.usage;
      if (typeof usage?.input === "number") inputTokens = usage.input;
      if (typeof usage?.output === "number") outputTokens = usage.output;
      if (typeof usage?.cacheRead === "number") cacheRead = usage.cacheRead;
      if (typeof usage?.cacheWrite === "number") cacheWrite = usage.cacheWrite;
    } catch {
      // skip
    }
  }
  return { inputTokens, outputTokens, cacheRead, cacheWrite };
}

function writeSession(sessionFile: string, cwd: string, bodyChars: number, extraUser?: string, toolHeavy = false): { bytes: number; chunks: number } {
  const ts = Date.now();
  const iso = new Date(ts).toISOString();
  const header = { type: "session", version: 3, id: "live-w5", timestamp: iso, cwd };
  const modelChange = {
    type: "model_change",
    id: "m1",
    parentId: null,
    timestamp: iso,
    provider: LIVE_PROVIDER,
    modelId: LIVE_MODEL,
  };
  const firstUser = {
    type: "message",
    id: "u1",
    parentId: "m1",
    timestamp: iso,
    message: {
      role: "user",
      content: [{ type: "text", text: "do not deploy prod; version is 6. Fill context then continue." }],
      timestamp: ts,
    },
  };
  const assistant = {
    type: "message",
    id: "a1",
    parentId: "u1",
    timestamp: iso,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Loading historical dumps." }],
      api: "openai-completions",
      provider: LIVE_PROVIDER,
      model: LIVE_MODEL,
      usage: {
        input: 32,
        output: 8,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 40,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: ts + 1,
    },
  };
  const rows: unknown[] = [header, modelChange, firstUser, assistant];
  let parent = "a1";
  let i = 0;
  if (toolHeavy) {
    const dump = filler(Math.max(bodyChars, 24_000));
    rows.push({
      type: "message",
      id: "t1",
      parentId: parent,
      timestamp: iso,
      message: {
        role: "toolResult",
        toolCallId: "call_dump",
        toolName: "bash",
        content: [{ type: "text", text: dump }],
        timestamp: ts + 2,
      },
    });
    parent = "t1";
    i += 1;
  } else {
    const chunk = 6_000;
    let remaining = bodyChars;
    while (remaining > 0) {
      const n = Math.min(chunk, remaining);
      const id = `f${i}`;
      rows.push({
        type: "message",
        id,
        parentId: parent,
        timestamp: iso,
        message: {
          role: "user",
          content: [{ type: "text", text: filler(n) }],
          timestamp: ts + 2 + i,
        },
      });
      parent = id;
      remaining -= n;
      i += 1;
    }
  }
  if (extraUser) {
    rows.push({
      type: "message",
      id: "u-tail",
      parentId: parent,
      timestamp: iso,
      message: { role: "user", content: [{ type: "text", text: extraUser }], timestamp: ts + 2 + i },
    });
  }
  mkdirSync(dirname(sessionFile), { recursive: true });
  const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  writeFileSync(sessionFile, text);
  return { bytes: Buffer.byteLength(text), chunks: i };
}

function copyAgent(keepRecentTokens: number): string {
  if (keepRecentTokens !== PI_DEFAULT_KEEP_RECENT) {
    throw new W5LiveError("PCR_W5_KEEP_RECENT_LOWERED", { keepRecentTokens });
  }
  const homeModels = join(homedir(), ".pi/agent/models.json");
  if (!existsSync(homeModels)) throw new W5LiveError("PCR_LIVE_PROVIDER_UNAVAILABLE", { missing: "models.json" });
  const agentDir = mkdtempSync(join(tmpdir(), "pcr-w5-live-agent-"));
  copyFileSync(homeModels, join(agentDir, "models.json"));
  const homeAuth = join(homedir(), ".pi/agent/auth.json");
  if (existsSync(homeAuth)) copyFileSync(homeAuth, join(agentDir, "auth.json"));
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({
      defaultProvider: LIVE_PROVIDER,
      defaultModel: LIVE_MODEL,
      compaction: {
        enabled: true,
        reserveTokens: LIVE_RESERVE_TOKENS,
        keepRecentTokens,
      },
    }, null, 2)}\n`,
  );
  return agentDir;
}

function isThresholdCompact(row: { reason: string | null; tokensBefore: number | null }): boolean {
  if (row.reason === "threshold") return true;
  return typeof row.tokensBefore === "number" && row.tokensBefore >= NATURAL_THRESHOLD_TOKENS;
}

function inspectCompactions(sessionFile: string): Array<{
  fromHook: boolean;
  reason: string | null;
  firstKeptEntryId: string | null;
  tokensBefore: number | null;
  summary: string;
}> {
  const rows: Array<{
    fromHook: boolean;
    reason: string | null;
    firstKeptEntryId: string | null;
    tokensBefore: number | null;
    summary: string;
  }> = [];
  if (!existsSync(sessionFile)) return rows;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"type":"compaction"')) continue;
    const parsed = JSON.parse(line) as {
      type?: string;
      fromHook?: boolean;
      reason?: string;
      firstKeptEntryId?: string;
      tokensBefore?: number;
      summary?: string;
    };
    if (parsed.type !== "compaction") continue;
    rows.push({
      fromHook: parsed.fromHook === true,
      reason: parsed.reason ?? null,
      firstKeptEntryId: parsed.firstKeptEntryId ?? null,
      tokensBefore: typeof parsed.tokensBefore === "number" ? parsed.tokensBefore : null,
      summary: parsed.summary ?? "",
    });
  }
  return rows;
}

async function withRpc<T>(opts: {
  sessionFile: string;
  cwd: string;
  agentDir: string;
  extension?: string;
  autoCompact: boolean;
  work: (rpc: PiRpc) => Promise<T>;
}): Promise<T> {
  const args = [
    "--no-extensions",
    "--offline",
    "--no-tools",
    "--session-dir",
    dirname(opts.sessionFile),
    "--session",
    opts.sessionFile,
    "--provider",
    LIVE_PROVIDER,
    "--model",
    LIVE_MODEL,
  ];
  if (opts.extension) args.unshift("-e", opts.extension);
  const rpc = new PiRpc({
    cliPath: resolvePiCli(),
    cwd: opts.cwd,
    args,
    env: {
      ...process.env,
      PATH: `${nvmBin()}:${process.env.PATH ?? ""}`,
      PI_OFFLINE: "1",
      PI_CODING_AGENT_DIR: opts.agentDir,
    },
  });
  await rpc.start();
  try {
    await rpc.request({ type: "set_auto_compaction", enabled: opts.autoCompact }, 15_000);
    try {
      await rpc.request({ type: "set_thinking_level", level: "off" }, 15_000);
    } catch {
      // optional
    }
    return await opts.work(rpc);
  } finally {
    await rpc.stop().catch(() => undefined);
  }
}

async function readTurnUsage(rpc: PiRpc, sessionFile: string): Promise<Record<string, unknown>> {
  const usage = lastAssistantUsage(sessionFile);
  let stateTokens: number | null = null;
  try {
    const state = await rpc.request({ type: "get_state" }, 15_000);
    const data = state.data as { contextUsage?: { tokens?: number }; tokens?: number } | undefined;
    if (typeof data?.contextUsage?.tokens === "number") stateTokens = data.contextUsage.tokens;
    else if (typeof data?.tokens === "number") stateTokens = data.tokens;
  } catch {
    // Host may not expose get_state tokens
  }
  const compact = inspectCompactions(sessionFile);
  const billed = typeof usage.inputTokens === "number" && typeof usage.cacheRead === "number"
    ? usage.inputTokens + usage.cacheRead
    : usage.inputTokens;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    billedTokens: billed,
    stateTokens,
    compactCount: compact.length,
    reason: compact.at(-1)?.reason ?? null,
    tokensBefore: compact.at(-1)?.tokensBefore ?? null,
  };
}

async function growLive(rpc: PiRpc, sessionFile: string, input: {
  maxTurns: number;
  charsPerTurn: number;
  stopOnCompact: boolean;
  stopOnError: boolean;
  thresholdTokens?: number;
  onTurn?: (log: Array<Record<string, unknown>>) => void;
}): Promise<Array<Record<string, unknown>>> {
  const log: Array<Record<string, unknown>> = [];
  for (let turn = 0; turn < input.maxTurns; turn += 1) {
    const before = inspectCompactions(sessionFile).length;
    try {
      await rpc.promptAndWait(
        `Turn ${turn}. Hard constraint: do not deploy prod. version is 6.\n${filler(input.charsPerTurn)}`,
        4 * 60_000,
      );
      const usage = await readTurnUsage(rpc, sessionFile);
      const compactCount = Number(usage.compactCount ?? 0);
      log.push({ turn, ok: true, ...usage });
      input.onTurn?.(log);
      if (input.stopOnCompact && compactCount > before) return log;
      const observed = typeof usage.billedTokens === "number"
        ? usage.billedTokens
        : typeof usage.inputTokens === "number"
          ? usage.inputTokens
          : typeof usage.stateTokens === "number" ? usage.stateTokens : null;
      if (input.thresholdTokens && observed !== null && observed > input.thresholdTokens + 8_192 && compactCount === before) {
        log.push({ turn, ok: true, providerWindowMismatch: true, observedTokens: observed, advertisedThreshold: input.thresholdTokens });
        input.onTurn?.(log);
        return log;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.push({ turn, ok: false, error: message, overflow: isContextOverflowError(message) });
      input.onTurn?.(log);
      if (input.stopOnError) return log;
      throw error;
    }
  }
  return log;
}

function persistReport(outDir: string, report: unknown, sessions: Array<{ name: string; file: string }>): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const session of sessions) {
    if (!existsSync(session.file)) continue;
    mkdirSync(join(outDir, session.name), { recursive: true });
    copyFileSync(session.file, join(outDir, session.name, "session.jsonl"));
  }
}

function persistPartial(outDir: string, name: string, payload: unknown, sessionFile?: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.partial.json`), `${JSON.stringify(payload, null, 2)}\n`);
  if (sessionFile && existsSync(sessionFile)) {
    mkdirSync(join(outDir, name), { recursive: true });
    copyFileSync(sessionFile, join(outDir, name, "session.jsonl"));
  }
}

function isolatedArm(root: string, arm: string, bodyChars: number, extraUser: string, toolHeavy: boolean): {
  cwd: string;
  sessionFile: string;
  agentDir: string;
} {
  const cwd = join(root, arm, "ws");
  mkdirSync(cwd, { recursive: true });
  const sessionFile = join(root, arm, "session.jsonl");
  writeSession(sessionFile, cwd, bodyChars, extraUser, toolHeavy);
  return { cwd, sessionFile, agentDir: copyAgent(PI_DEFAULT_KEEP_RECENT) };
}

async function runNaturalFamily(input: {
  repoRoot: string;
  root: string;
  family: "large-turn" | "tool-heavy";
  extension: string;
  outDir: string;
}): Promise<Record<string, unknown>> {
  const extra = input.family === "tool-heavy"
    ? "start the long tool-heavy task; do not deploy prod"
    : "start the large single-turn growth; do not deploy prod";
  const native = isolatedArm(join(input.root, input.family), "native", input.family === "tool-heavy" ? 24_000 : 8_000, extra, input.family === "tool-heavy");
  const pcr = isolatedArm(join(input.root, input.family), "pcr", input.family === "tool-heavy" ? 24_000 : 8_000, extra, input.family === "tool-heavy");
  let nativeError: string | undefined;
  let pcrError: string | undefined;
  let nativeTurns: Array<Record<string, unknown>> = [];
  let pcrTurns: Array<Record<string, unknown>> = [];
  let nativeStarted = false;
  let pcrStarted = false;
  let nativeContinuation: string | undefined;
  let pcrContinuation: string | undefined;
  try {
    nativeTurns = await withRpc({
      sessionFile: native.sessionFile,
      cwd: native.cwd,
      agentDir: native.agentDir,
      autoCompact: true,
      work: async (rpc) => {
        nativeStarted = true;
        const grown = await growLive(rpc, native.sessionFile, {
          maxTurns: 40,
          charsPerTurn: 40_000,
          stopOnCompact: true,
          stopOnError: true,
          thresholdTokens: NATURAL_THRESHOLD_TOKENS,
          onTurn: (log) => persistPartial(input.outDir, `${input.family}-native`, { turns: log }, native.sessionFile),
        });
        if (inspectCompactions(native.sessionFile).length > 0) {
          await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", 3 * 60_000);
          nativeContinuation = lastAssistantUsage(native.sessionFile).inputTokens !== null ? "asked" : "asked";
        }
        return grown;
      },
    });
  } catch (error) {
    nativeError = error instanceof Error ? error.message : String(error);
  }
  try {
    pcrTurns = await withRpc({
      sessionFile: pcr.sessionFile,
      cwd: pcr.cwd,
      agentDir: pcr.agentDir,
      extension: input.extension,
      autoCompact: true,
      work: async (rpc) => {
        pcrStarted = true;
        const grown = await growLive(rpc, pcr.sessionFile, {
          maxTurns: 40,
          charsPerTurn: 40_000,
          stopOnCompact: true,
          stopOnError: true,
          thresholdTokens: NATURAL_THRESHOLD_TOKENS,
          onTurn: (log) => persistPartial(input.outDir, `${input.family}-pcr`, { turns: log }, pcr.sessionFile),
        });
        if (inspectCompactions(pcr.sessionFile).length > 0) {
          await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", 3 * 60_000);
          pcrContinuation = "asked";
        }
        return grown;
      },
    });
  } catch (error) {
    pcrError = error instanceof Error ? error.message : String(error);
  } finally {
    rmSync(native.agentDir, { recursive: true, force: true });
    rmSync(pcr.agentDir, { recursive: true, force: true });
  }
  const nativeCompactions = inspectCompactions(native.sessionFile);
  const pcrCompactions = inspectCompactions(pcr.sessionFile);
  return {
    family: input.family,
    providerStarted: nativeStarted || pcrStarted,
    native: {
      error: nativeError,
      turns: nativeTurns,
      compactions: nativeCompactions,
      continuation: nativeContinuation ?? null,
      sessionFile: native.sessionFile,
      cwd: native.cwd,
      agentDir: native.agentDir,
    },
    pcr: {
      error: pcrError,
      turns: pcrTurns,
      compactions: pcrCompactions,
      continuation: pcrContinuation ?? null,
      sessionFile: pcr.sessionFile,
      cwd: pcr.cwd,
      agentDir: pcr.agentDir,
    },
    triggered: nativeCompactions.some((row) => isThresholdCompact(row)) && pcrCompactions.some((row) => isThresholdCompact(row)),
    compactCount: nativeCompactions.length + pcrCompactions.length,
  };
}

export async function runNaturalThreshold(repoRoot: string): Promise<Record<string, unknown>> {
  const outDir = join(repoRoot, "artifacts/runs/w2-v3-live/natural-threshold");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  const threshold = NATURAL_THRESHOLD_TOKENS;
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
    const report = {
      lane: "natural-threshold",
      liveProvider: false,
      providerStarted: false,
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      contextWindow: LIVE_CONTEXT_WINDOW,
      triggerThreshold: threshold,
      manualCompact: false,
      triggered: false,
      error: "PCR_LIVE_PROVIDER_UNAVAILABLE",
    };
    assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount: 0,
      triggered: false,
      liveProvider: false,
      providerStarted: false,
    });
    persistReport(outDir, report, []);
    return report;
  }
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-natural-"));
  const families: Array<Record<string, unknown>> = [];
  try {
    for (const family of ["large-turn", "tool-heavy"] as const) {
      families.push(await runNaturalFamily({ repoRoot, root, family, extension, outDir }));
    }
    const providerStarted = families.some((row) => row.providerStarted === true);
    const compactCount = families.reduce((sum, row) => sum + Number(row.compactCount ?? 0), 0);
    const triggered = families.every((row) => row.triggered === true);
    const report = {
      lane: "natural-threshold",
      liveProvider: providerStarted,
      providerStarted,
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      contextWindow: LIVE_CONTEXT_WINDOW,
      triggerThreshold: threshold,
      manualCompact: false,
      families,
      triggered,
      compactCount,
    };
    assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount,
      triggered,
      liveProvider: providerStarted,
      providerStarted,
    });
    const sessions = families.flatMap((family) => {
      const native = family.native as { sessionFile?: string; agentDir?: string };
      const pcr = family.pcr as { sessionFile?: string; agentDir?: string };
      return [
        { name: `${String(family.family)}-native`, file: native.sessionFile ?? "" },
        { name: `${String(family.family)}-pcr`, file: pcr.sessionFile ?? "" },
      ];
    });
    const slimed = {
      ...report,
      families: families.map((family) => {
        const native = family.native as Record<string, unknown>;
        const pcr = family.pcr as Record<string, unknown>;
        return {
          family: family.family,
          providerStarted: family.providerStarted,
          triggered: family.triggered,
          compactCount: family.compactCount,
          native: { error: native.error, turns: native.turns, compactions: native.compactions, continuation: native.continuation },
          pcr: { error: pcr.error, turns: pcr.turns, compactions: pcr.compactions, continuation: pcr.continuation },
        };
      }),
    };
    persistReport(outDir, slimed, sessions);
    return slimed;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runOverflowArm(input: {
  root: string;
  outDir: string;
  name: "native" | "pcr";
  extension?: string;
}): Promise<{
  name: "native" | "pcr";
  sessionFile: string;
  agentDir: string;
  providerStarted: boolean;
  attempts: Array<Record<string, unknown>>;
  overflowObserved: boolean;
  usedManualCompactAsOverflow: boolean;
}> {
  const arm = isolatedArm(
    input.root,
    input.name,
    8_000,
    input.name === "native"
      ? "grow until provider overflow; native arm; do not deploy prod"
      : "grow until provider overflow; do not deploy prod",
    false,
  );
  const attempts: Array<Record<string, unknown>> = [];
  let providerStarted = false;
  try {
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension: input.extension,
      autoCompact: false,
      work: async (rpc) => {
        providerStarted = true;
        const grown = await growLive(rpc, arm.sessionFile, {
          maxTurns: 25,
          charsPerTurn: 40_000,
          stopOnCompact: false,
          stopOnError: true,
          onTurn: (log) => persistPartial(input.outDir, input.name, { phase: "grow", turns: log }, arm.sessionFile),
        });
        attempts.push({ phase: "grow", ok: true, grown });
        persistPartial(input.outDir, input.name, { phase: "grow", attempts }, arm.sessionFile);
        const overflowed = grown.some((row) => row.overflow === true);
        if (!overflowed) {
          try {
            await rpc.promptAndWait(filler(40_000 * 4), 3 * 60_000);
            attempts.push({ phase: "overflow-prompt", ok: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            attempts.push({
              phase: "overflow-prompt",
              ok: false,
              overflow: isContextOverflowError(message),
              error: message,
            });
          }
        }
        const overflowObserved = attempts.some((row) => row.overflow === true)
          || grown.some((row) => row.overflow === true);
        persistPartial(input.outDir, input.name, { phase: "after-overflow-prompt", attempts, overflowObserved }, arm.sessionFile);
        if (!overflowObserved) {
          attempts.push({ phase: "skip-hand-compact", ok: true, reason: "no-provider-overflow" });
          persistPartial(input.outDir, input.name, { phase: "skip-hand-compact", attempts }, arm.sessionFile);
          return;
        }
        const failHash = sha(rpc.stderr.slice(-800) || "overflow");
        attempts.push({ phase: "overflow-request", ok: false, requestHash: failHash });
        const beforeTokens = lastAssistantUsage(arm.sessionFile).inputTokens;
        const compacted = await rpc.compact();
        const after = inspectCompactions(arm.sessionFile).at(-1);
        const compactHash = sha(`${after?.tokensBefore ?? ""}:${after?.summary ?? JSON.stringify(compacted)}`);
        attempts.push({
          phase: "compact",
          ok: true,
          compactHash,
          tokensBefore: after?.tokensBefore ?? null,
        });
        persistPartial(input.outDir, input.name, { phase: "compact", attempts }, arm.sessionFile);
        await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", 3 * 60_000);
        const afterTokens = lastAssistantUsage(arm.sessionFile).inputTokens;
        const retryHash = sha(`${afterTokens ?? ""}:${inspectCompactions(arm.sessionFile).at(-1)?.summary ?? ""}`);
        attempts.push({
          phase: "retry",
          ok: true,
          compactHash: retryHash,
          requestHash: retryHash,
          inputTokens: afterTokens,
          tokensDropped: beforeTokens !== null && afterTokens !== null ? afterTokens < beforeTokens : false,
        });
        persistPartial(input.outDir, input.name, { phase: "retry", attempts }, arm.sessionFile);
      },
    });
  } catch (error) {
    attempts.push({ phase: "rpc", ok: false, error: error instanceof Error ? error.message : String(error) });
    persistPartial(input.outDir, input.name, { phase: "rpc", attempts }, arm.sessionFile);
  }
  const overflowObserved = attempts.some((row) => row.overflow === true)
    || attempts.some((row) => Array.isArray(row.grown) && (row.grown as Array<{ overflow?: boolean }>).some((item) => item.overflow === true));
  const usedManualCompactAsOverflow = !overflowObserved && attempts.some((row) => row.phase === "compact");
  return {
    name: input.name,
    sessionFile: arm.sessionFile,
    agentDir: arm.agentDir,
    providerStarted,
    attempts,
    overflowObserved,
    usedManualCompactAsOverflow,
  };
}

export async function runProviderOverflow(repoRoot: string): Promise<Record<string, unknown>> {
  const outDir = join(repoRoot, "artifacts/runs/w2-v3-live/overflow");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
    const report = {
      lane: "provider-overflow",
      liveProvider: false,
      autoCompact: false,
      overflowObserved: false,
      usedManualCompactAsOverflow: false,
      compactThenRetry: false,
      hashesChange: false,
      tokensStrictlyDecrease: false,
      error: "PCR_LIVE_PROVIDER_UNAVAILABLE",
    };
    persistReport(outDir, report, []);
    return report;
  }
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-overflow-"));
  let native: Awaited<ReturnType<typeof runOverflowArm>> | undefined;
  let pcr: Awaited<ReturnType<typeof runOverflowArm>> | undefined;
  try {
    native = await runOverflowArm({ root, outDir, name: "native" });
    pcr = await runOverflowArm({ root, outDir, name: "pcr", extension });
  } catch (error) {
    persistPartial(outDir, "fatal", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  const attempts = pcr.attempts;
  const overflowObserved = native.overflowObserved || pcr.overflowObserved;
  const usedManualCompactAsOverflow = native.usedManualCompactAsOverflow || pcr.usedManualCompactAsOverflow;
  const hashes = [...native.attempts, ...pcr.attempts]
    .map((row) => row.compactHash)
    .filter((value): value is string => typeof value === "string");
  const retry = [...native.attempts, ...pcr.attempts].find((row) => row.phase === "retry");
  const report = {
    lane: "provider-overflow",
    liveProvider: native.providerStarted || pcr.providerStarted,
    autoCompact: false,
    attempts,
    arms: {
      native: {
        providerStarted: native.providerStarted,
        overflowObserved: native.overflowObserved,
        usedManualCompactAsOverflow: native.usedManualCompactAsOverflow,
        attempts: native.attempts,
      },
      pcr: {
        providerStarted: pcr.providerStarted,
        overflowObserved: pcr.overflowObserved,
        usedManualCompactAsOverflow: pcr.usedManualCompactAsOverflow,
        attempts: pcr.attempts,
      },
    },
    overflowObserved,
    usedManualCompactAsOverflow,
    compactThenRetry: overflowObserved
      && [...native.attempts, ...pcr.attempts].some((row) => row.phase === "compact" && row.ok)
      && [...native.attempts, ...pcr.attempts].some((row) => row.phase === "retry" && row.ok),
    hashesChange: new Set(hashes).size >= 2,
    tokensStrictlyDecrease: retry?.tokensDropped === true,
  };
  persistReport(outDir, report, [
    { name: "native", file: native.sessionFile },
    { name: "pcr", file: pcr.sessionFile },
  ]);
  rmSync(root, { recursive: true, force: true });
  rmSync(native.agentDir, { recursive: true, force: true });
  rmSync(pcr.agentDir, { recursive: true, force: true });
  if (overflowObserved) {
    assertOverflowPolicy({
      overflowObserved,
      usedManualCompactAsOverflow,
      hashesChange: report.hashesChange,
      tokensStrictlyDecrease: report.tokensStrictlyDecrease,
    });
  }
  return report;
}

export async function runRecursiveLive(repoRoot: string): Promise<Record<string, unknown>> {
  const outDir = join(repoRoot, "artifacts/runs/w2-v3-live/recursive");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
    const report = {
      lane: "recursive-long-horizon",
      liveProvider: false,
      compactCount: 0,
      threeCompacts: false,
      error: "PCR_LIVE_PROVIDER_UNAVAILABLE",
    };
    persistReport(outDir, report, []);
    return report;
  }
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-recursive-"));
  const arm = isolatedArm(root, "pcr", 120_000, "keep version 6; do not deploy production", false);
  const history: Array<{ phase: string; ok: boolean; error?: string; compactCount?: number; summary?: string }> = [];
  let providerStarted = false;
  try {
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension,
      autoCompact: false,
      work: async (rpc) => {
        providerStarted = true;
        await rpc.compact();
        history.push({ phase: "compact-1", ok: true, compactCount: inspectCompactions(arm.sessionFile).length });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("改为 version 7. Do not deploy production.", 3 * 60_000);
        history.push({ phase: "temporal-update", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait(`Grow before compact 2.\n${filler(80_000)}`, 3 * 60_000);
        history.push({ phase: "grow-before-compact-2", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.compact();
        history.push({ phase: "compact-2", ok: true, compactCount: inspectCompactions(arm.sessionFile).length });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
      },
    });
    const beforeRestart = readFileSync(arm.sessionFile, "utf8");
    const lines = beforeRestart.trim().split("\n");
    const last = JSON.parse(lines.at(-1) ?? "{}") as { id?: string };
    const branchUser = {
      type: "message",
      id: "u-branch",
      parentId: last.id ?? "t1",
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text: "Park the previous front. New branch: recall whether version 7 is active. Do not merge sibling-branch." }],
        timestamp: Date.now(),
      },
    };
    writeFileSync(arm.sessionFile, `${beforeRestart.trim()}\n${JSON.stringify(branchUser)}\n`);
    history.push({ phase: "branch-after-compact-2", ok: true });
    persistPartial(outDir, "pcr", { history }, arm.sessionFile);
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension,
      autoCompact: false,
      work: async (rpc) => {
        history.push({ phase: "restart-before-compact-3", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait(`Add more history before compact 3.\n${filler(80_000)}`, 3 * 60_000);
        await rpc.compact();
        history.push({
          phase: "compact-3",
          ok: true,
          compactCount: inspectCompactions(arm.sessionFile).length,
          summary: inspectCompactions(arm.sessionFile).at(-1)?.summary.slice(0, 400),
        });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("What version is currently active? Reply with the version string only.", 3 * 60_000);
        history.push({ phase: "recall-needed", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("Should we merge sibling-branch now? Answer yes or no.", 3 * 60_000);
        history.push({ phase: "recall-not-needed", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
      },
    });
  } catch (error) {
    history.push({ phase: "rpc", ok: false, error: error instanceof Error ? error.message : String(error) });
    persistPartial(outDir, "pcr", { history }, arm.sessionFile);
  }
  const compactions = inspectCompactions(arm.sessionFile);
  const summaries = compactions.map((row) => row.summary);
  const report = {
    lane: "recursive-long-horizon",
    liveProvider: providerStarted,
    history,
    compactCount: compactions.length,
    threeCompacts: compactions.length >= 3,
    branched: history.some((row) => row.phase === "branch-after-compact-2" && row.ok),
    restarted: history.some((row) => row.phase === "restart-before-compact-3" && row.ok),
    sideEffectGuard: summaries.every((text) => !/we deployed successfully|已成功部署/i.test(text)),
  };
  persistReport(outDir, report, [{ name: "pcr", file: arm.sessionFile }]);
  rmSync(root, { recursive: true, force: true });
  rmSync(arm.agentDir, { recursive: true, force: true });
  return report;
}

export function w5LiveProfileFromEnv(value = process.env.PCR_W5_LIVE_PROFILE): W5LiveProfile {
  if (value === "natural" || value === "overflow" || value === "recursive" || value === "all") return value;
  return "all";
}

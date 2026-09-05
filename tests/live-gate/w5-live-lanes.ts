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
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiRpc } from "./pi-rpc.js";
import { resolvePiCli } from "./pi-resolve.js";
import { LIVE_MODEL, LIVE_PROVIDER, LIVE_RESERVE_TOKENS } from "./w1-session-jsonl.js";
import { evaluateNaturalPressureArm } from "../../packages/benchmark/src/performance/lanes.js";
import { countSideEffectEvents, runForcedOverflowRecovery } from "./forced-overflow-provider.js";

export { LIVE_RESERVE_TOKENS };

export const PI_DEFAULT_KEEP_RECENT = 20_000;
export const LIVE_CONTEXT_WINDOW = 200_192;
export const NATURAL_THRESHOLD_TOKENS = LIVE_CONTEXT_WINDOW - LIVE_RESERVE_TOKENS;

export type W5LiveProfile = "natural" | "overflow" | "recursive" | "recursive-auto" | "long-horizon" | "all";

function promptTimeoutMs(): number {
  const raw = Number(process.env.PCR_W5_PROMPT_TIMEOUT_MS ?? 3 * 60_000);
  return Number.isSafeInteger(raw) && raw >= 5_000 && raw <= 10 * 60_000 ? raw : 3 * 60_000;
}

export type W5LiveErrorCode =
  | "PCR_LIVE_PROVIDER_UNAVAILABLE"
  | "PCR_W5_KEEP_RECENT_LOWERED"
  | "PCR_W5_RESERVE_LOWERED"
  | "PCR_W5_MANUAL_COMPACT"
  | "PCR_W5_FAKE_LIVE_PROVIDER"
  | "PCR_W5_TRIGGER_WITHOUT_COMPACT"
  | "PCR_W5_OVERFLOW_HAND_COMPACT"
  | "PCR_W5_LIVE_PROFILE_INVALID";

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

export function liveOutputDir(repoRoot: string, lane: "natural-threshold" | "overflow" | "recursive"): string {
  const configuredRoot = process.env.PCR_W5_LIVE_OUT_DIR;
  const root = configuredRoot
    ? (isAbsolute(configuredRoot) ? configuredRoot : resolve(repoRoot, configuredRoot))
    : join(repoRoot, "artifacts/runs/w2-v3-live");
  return join(root, lane);
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

export function evaluateBranchLineage(entries: readonly Record<string, unknown>[], branchId = "u-branch", expectedParentId?: string | null): {
  branchId: string;
  branchParentId: string | null;
  parentExists: boolean;
  isSibling: boolean;
  restartHeadPresent: boolean;
  ok: boolean;
} {
  const byId = new Map<string, Record<string, unknown>>();
  let idConflict = false;
  for (const entry of entries) {
    if (typeof entry.id !== "string") continue;
    const existing = byId.get(entry.id);
    if (existing && canonical(existing) !== canonical(entry)) idConflict = true;
    else byId.set(entry.id, entry);
  }
  const branch = byId.get(branchId);
  const parentId = typeof branch?.parentId === "string" ? branch.parentId : null;
  const expectedParentMatches = expectedParentId === undefined || parentId === expectedParentId;
  const parent = parentId ? byId.get(parentId) : undefined;
  const sibling = parentId
    ? entries.some((entry) => entry !== branch
      && typeof entry.id === "string"
      && entry.id !== branchId
      && entry.parentId === parentId)
    : false;
  let restartHeadPresent = false;
  let cursor = entries.at(-1);
  const visited = new Set<string>();
  while (cursor && typeof cursor.id === "string" && !visited.has(cursor.id)) {
    if (cursor.id === branchId) { restartHeadPresent = true; break; }
    visited.add(cursor.id);
    cursor = typeof cursor.parentId === "string" ? byId.get(cursor.parentId) : undefined;
  }
  return {
    branchId,
    branchParentId: parentId,
    parentExists: parent !== undefined,
    isSibling: sibling,
    restartHeadPresent,
    ok: !idConflict && expectedParentMatches && parent !== undefined && sibling && restartHeadPresent,
  };
}

export function evaluateForkLineage(
  sourceEntries: readonly Record<string, unknown>[],
  forkEntries: readonly Record<string, unknown>[],
  sourceSession: string,
  branchId: string,
  expectedParentId?: string | null,
): { parentSessionMatches: boolean; parentExists: boolean; sourceSiblingExists: boolean; branchPresent: boolean; activeHeadPresent: boolean; ok: boolean } {
  const forkById = new Map<string, Record<string, unknown>>();
  let idConflict = false;
  for (const entry of forkEntries) {
    if (typeof entry.id !== "string") continue;
    const existing = forkById.get(entry.id);
    if (existing && canonical(existing) !== canonical(entry)) idConflict = true;
    else forkById.set(entry.id, entry);
  }
  const branch = forkById.get(branchId);
  const parentId = typeof branch?.parentId === "string" ? branch.parentId : null;
  const forkHeader = forkEntries.find((entry) => entry.type === "session");
  const expectedParentMatches = expectedParentId === undefined || parentId === expectedParentId;
  const parentExists = expectedParentMatches && parentId !== null && forkById.has(parentId);
  const sourceSiblingExists = parentId !== null && sourceEntries.some((entry) => typeof entry.id === "string" && entry.id !== branchId && entry.parentId === parentId);
  const activeHeadPresent = forkById.has(branchId);
  const parentSessionMatches = typeof forkHeader?.parentSession === "string" && forkHeader.parentSession === sourceSession;
  return { parentSessionMatches, parentExists, sourceSiblingExists, branchPresent: branch !== undefined, activeHeadPresent, ok: !idConflict && parentSessionMatches && parentExists && sourceSiblingExists && activeHeadPresent };
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

function lastAssistantText(sessionFile: string): string {
  if (!existsSync(sessionFile)) return "";
  let text = "";
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    try {
      const parsed = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const content = parsed.message.content;
      text = typeof content === "string" ? content : Array.isArray(content)
        ? content.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text?: unknown }).text ?? "") : "").join("")
        : "";
    } catch { /* ignore malformed session lines */ }
  }
  return text;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function isForbiddenSideEffectEvent(input: { toolName: string; args: unknown; result: unknown }): boolean {
  const toolName = input.toolName;
  if (/(?:^|[-_.])(?:deploy|publish|release)(?:$|[-_.])/i.test(toolName)) return true;
  if (/^(?:bash|shell|sh|terminal)$/i.test(toolName)) {
    const args = input.args;
    const command = typeof args === "string"
      ? args
      : typeof args === "object" && args !== null
        ? String((args as Record<string, unknown>).command ?? (args as Record<string, unknown>).cmd ?? (args as Record<string, unknown>).script ?? "")
        : "";
    if (/(?:^|[;&|]\s*)(?:sudo\s+)?(?:kubectl\s+(?:apply|create|rollout)|helm\s+(?:install|upgrade)|npm\s+publish|docker\s+push|git\s+push|deploy\b|publish\b)/i.test(command.trim())) return true;
  }
  const result = canonical(input.result);
  if (/\b(?:not|never)\s+(?:published|deployed)\b|\bno\s+deployment\b|未发布|未部署/i.test(result)) return false;
  return /\b(?:deployment\s+(?:succeeded|successful)|deployed\s+(?:prod|production)|published)\b|已成功部署|部署成功/i.test(result);
}

export function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
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
  const provider = process.env.PCR_LIVE_PROVIDER?.trim();
  const modelId = process.env.PCR_LIVE_MODEL?.trim();
  if (process.env.PCR_LIVE === "1" && provider && modelId && process.env.PCR_LIVE_API_KEY?.trim() && process.env.PCR_LIVE_BASE_URL?.trim()) {
    const source = JSON.parse(readFileSync(homeModels, "utf8")) as { providers?: Record<string, unknown> };
    const template = (source.providers?.openclaw ?? {}) as Record<string, unknown>;
    source.providers = {
      ...(source.providers ?? {}),
      [provider]: {
        ...template,
        baseUrl: process.env.PCR_LIVE_BASE_URL,
        apiKey: process.env.PCR_LIVE_API_KEY,
        models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: LIVE_CONTEXT_WINDOW, maxTokens: LIVE_RESERVE_TOKENS, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    };
    writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(source, null, 2)}\n`);
  } else {
    copyFileSync(homeModels, join(agentDir, "models.json"));
  }
  const homeAuth = join(homedir(), ".pi/agent/auth.json");
  if (existsSync(homeAuth)) copyFileSync(homeAuth, join(agentDir, "auth.json"));
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({
      defaultProvider: process.env.PCR_LIVE_PROVIDER?.trim() || LIVE_PROVIDER,
      defaultModel: process.env.PCR_LIVE_MODEL?.trim() || LIVE_MODEL,
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
  tools?: boolean;
  work: (rpc: PiRpc) => Promise<T>;
}): Promise<T> {
  const provider = process.env.PCR_LIVE_PROVIDER?.trim() || LIVE_PROVIDER;
  const model = process.env.PCR_LIVE_MODEL?.trim() || LIVE_MODEL;
  const args = [
    "--no-extensions",
    ...(opts.tools ? [] : ["--no-tools"]),
    "--session-dir",
    dirname(opts.sessionFile),
    "--session",
    opts.sessionFile,
    "--provider",
    provider,
    "--model",
    model,
  ];
  if (opts.extension) args.unshift("-e", opts.extension);
  const liveEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${nvmBin()}:${process.env.PATH ?? ""}`, PCR_LIVE_PROVIDER: provider, PCR_LIVE_MODEL: model };
  if (process.env.PCR_LIVE === "1") delete liveEnv.PI_OFFLINE;
  else liveEnv.PI_OFFLINE = "1";
  const rpc = new PiRpc({
    cliPath: resolvePiCli(),
    cwd: opts.cwd,
    args,
    env: {
      ...liveEnv,
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
          maxTurns: boundedPositiveInteger(process.env.PCR_W5_MAX_TURNS, 40, 100),
          charsPerTurn: boundedPositiveInteger(process.env.PCR_W5_CHARS_PER_TURN, 40_000, 200_000),
          stopOnCompact: true,
          stopOnError: true,
          thresholdTokens: NATURAL_THRESHOLD_TOKENS,
          onTurn: (log) => persistPartial(input.outDir, `${input.family}-native`, { turns: log }, native.sessionFile),
        });
        await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", promptTimeoutMs());
        nativeContinuation = "asked";
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
      // B2 may complete through bounded materialization without Host auto-compact.
      autoCompact: false,
      work: async (rpc) => {
        pcrStarted = true;
        const grown = await growLive(rpc, pcr.sessionFile, {
          maxTurns: boundedPositiveInteger(process.env.PCR_W5_MAX_TURNS, 40, 100),
          charsPerTurn: boundedPositiveInteger(process.env.PCR_W5_CHARS_PER_TURN, 40_000, 200_000),
          stopOnCompact: true,
          stopOnError: true,
          thresholdTokens: NATURAL_THRESHOLD_TOKENS,
          onTurn: (log) => persistPartial(input.outDir, `${input.family}-pcr`, { turns: log }, pcr.sessionFile),
        });
        await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", promptTimeoutMs());
        pcrContinuation = "asked";
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
  const latestTokens = (turns: readonly Record<string, unknown>[]): number | null => {
    const value = turns.at(-1)?.inputTokens;
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  };
  const nativeState = evaluateNaturalPressureArm({
    arm: "B0",
    hostCompactionCount: nativeCompactions.length,
    hostCompactReason: nativeCompactions.at(-1)?.reason === "threshold" ? "threshold" : null,
    hostCompactTokensBefore: nativeCompactions.at(-1)?.tokensBefore,
    materializationBounded: false,
    inputTokens: latestTokens(nativeTurns),
    effectiveInputUpperBound: NATURAL_THRESHOLD_TOKENS,
    overflowObserved: nativeTurns.some((row) => row.overflow === true),
    behaviorComplete: nativeContinuation === "asked",
  });
  const pcrState = evaluateNaturalPressureArm({
    arm: "B2",
    hostCompactionCount: pcrCompactions.filter((row) => row.fromHook !== true).length,
    hostCompactReason: null,
    materializationBounded: pcrCompactions.some((row) => row.fromHook === true),
    inputTokens: latestTokens(pcrTurns),
    effectiveInputUpperBound: NATURAL_THRESHOLD_TOKENS,
    overflowObserved: pcrTurns.some((row) => row.overflow === true),
    behaviorComplete: pcrContinuation === "asked",
  });
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
    triggered: nativeState.ok && pcrState.ok,
    armStates: { B0: nativeState, B2: pcrState },
    compactCount: nativeCompactions.length + pcrCompactions.length,
  };
}

export async function runNaturalThreshold(repoRoot: string): Promise<Record<string, unknown>> {
  const outDir = liveOutputDir(repoRoot, "natural-threshold");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  const threshold = NATURAL_THRESHOLD_TOKENS;
  mkdirSync(outDir, { recursive: true });
  if (process.env.PCR_LIVE !== "1" || !existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
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
      oracleComplete: false,
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
          armStates: family.armStates,
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
  recovery: Record<string, unknown> | null;
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
  let recoveryReport: Record<string, unknown> | null = null;
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
        const sideEffectCount = () => countSideEffectEvents(rpc.events);
        const overflowMaxTurns = boundedPositiveInteger(process.env.PCR_W5_OVERFLOW_MAX_TURNS ?? process.env.PCR_W5_MAX_TURNS, 25, 100);
        const overflowCharsPerTurn = boundedPositiveInteger(process.env.PCR_W5_OVERFLOW_CHARS_PER_TURN, 40_000, 200_000);
        const grown = await growLive(rpc, arm.sessionFile, {
          maxTurns: overflowMaxTurns,
          charsPerTurn: overflowCharsPerTurn,
          stopOnCompact: false,
          stopOnError: true,
          onTurn: (log) => persistPartial(input.outDir, input.name, { phase: "grow", turns: log }, arm.sessionFile),
        });
        attempts.push({ phase: "grow", ok: true, grown });
        persistPartial(input.outDir, input.name, { phase: "grow", attempts }, arm.sessionFile);
        const overflowed = grown.some((row) => row.overflow === true);
        if (!overflowed) {
          try {
            await rpc.promptAndWait(filler(40_000 * 4), promptTimeoutMs());
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
        const recovery = await runForcedOverflowRecovery({
          force: () => ({
            phase: "force",
            ok: false,
            error: String(attempts.find((row) => row.phase === "overflow-prompt")?.error
              ?? grown.find((row) => row.overflow === true)?.error
              ?? "context_length_exceeded"),
            sideEffectCount: sideEffectCount(),
          }),
          compact: async () => {
            const before = lastAssistantUsage(arm.sessionFile).inputTokens;
            const compacted = await rpc.compact();
            const after = inspectCompactions(arm.sessionFile).at(-1);
            return { phase: "compact", ok: true, outputHash: sha(`${after?.tokensBefore ?? ""}:${after?.summary ?? JSON.stringify(compacted)}`), tokensAfter: before ?? undefined, sideEffectCount: sideEffectCount() };
          },
          retry: async () => {
            const before = lastAssistantUsage(arm.sessionFile).inputTokens;
            await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", promptTimeoutMs());
            const after = lastAssistantUsage(arm.sessionFile).inputTokens;
            return { phase: "retry", ok: true, outputHash: sha(`${after ?? ""}:${inspectCompactions(arm.sessionFile).at(-1)?.summary ?? ""}`), tokensAfter: after ?? undefined, sideEffectCount: sideEffectCount(), error: before !== null && after !== null && after >= before ? "tokens-not-decreased" : undefined, tokensDropped: before !== null && after !== null && after < before };
          },
        });
        recoveryReport = { prevention: recovery.prevention, recovery: recovery.recovery };
        attempts.push(...recovery.attempts.map((row) => ({ ...row, compactHash: row.outputHash ?? null })));
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
    recovery: recoveryReport,
  };
}

export async function runProviderOverflow(repoRoot: string): Promise<Record<string, unknown>> {
  const outDir = liveOutputDir(repoRoot, "overflow");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  mkdirSync(outDir, { recursive: true });
  if (process.env.PCR_LIVE !== "1" || !existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
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
        recovery: native.recovery,
        attempts: native.attempts,
      },
      pcr: {
        providerStarted: pcr.providerStarted,
        overflowObserved: pcr.overflowObserved,
        usedManualCompactAsOverflow: pcr.usedManualCompactAsOverflow,
        recovery: pcr.recovery,
        attempts: pcr.attempts,
      },
    },
    overflowObserved,
    usedManualCompactAsOverflow,
    recoveryOk: [native, pcr]
      .filter((arm) => arm.overflowObserved)
      .every((arm) => arm.recovery !== null
        && (arm.recovery as { recovery?: { ok?: boolean } }).recovery?.ok === true),
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
    if (report.recoveryOk !== true) throw new W5LiveError("PCR_W5_OVERFLOW_HAND_COMPACT", { reason: "recovery-side-effect-or-retry-failed" });
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
  const outDir = liveOutputDir(repoRoot, "recursive");
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  mkdirSync(outDir, { recursive: true });
  if (process.env.PCR_LIVE !== "1" || !existsSync(join(homedir(), ".pi/agent/models.json")) || !existsSync(extension)) {
    const report = {
      lane: "recursive-long-horizon",
      liveProvider: false,
      compactCount: 0,
      threeCompacts: false,
      oracleComplete: false,
      error: "PCR_LIVE_PROVIDER_UNAVAILABLE",
    };
    persistReport(outDir, report, []);
    return report;
  }
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-recursive-"));
  const arm = isolatedArm(root, "pcr", 120_000, "keep version 6; do not deploy production", false);
  const history: Array<{ phase: string; ok: boolean; error?: string; compactCount?: number; summary?: string }> = [];
  const toolEvents: Array<Record<string, unknown>> = [];
  const treeEvents: Array<Record<string, unknown>> = [];
  const recursiveFillerChars = boundedPositiveInteger(process.env.PCR_W5_RECURSIVE_FILLER_CHARS, 80_000, 120_000);
  let branchLineage: ReturnType<typeof evaluateBranchLineage> | null = null;
  let forkEvidence: ReturnType<typeof evaluateForkLineage> | null = null;
  let branchEntryId = "";
  let providerStarted = false;
  try {
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension,
      autoCompact: true,
      tools: true,
      work: async (rpc) => {
        providerStarted = true;
        toolEvents.push(...rpc.events.filter((event) => typeof event.type === "string" && /tool/i.test(event.type)));
        treeEvents.push(...rpc.events.filter((event) => event.type === "session_tree"));
        const compact1Before = inspectCompactions(arm.sessionFile).length;
        await rpc.promptAndWait(`Grow before autonomous compact 1.\n${filler(recursiveFillerChars)}`, promptTimeoutMs());
        history.push({ phase: "compact-1", ok: inspectCompactions(arm.sessionFile).length > compact1Before, compactCount: inspectCompactions(arm.sessionFile).length });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("改为 version 7. Do not deploy production.", promptTimeoutMs());
        history.push({ phase: "temporal-update", ok: /\bversion\s*7\b/i.test(lastAssistantText(arm.sessionFile)) && !/\bversion\s*6\b/i.test(lastAssistantText(arm.sessionFile)) });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        const compact2Before = inspectCompactions(arm.sessionFile).length;
        await rpc.promptAndWait(`Grow before compact 2.\n${filler(recursiveFillerChars)}`, promptTimeoutMs());
        history.push({ phase: "grow-before-compact-2", ok: true });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        history.push({ phase: "compact-2", ok: inspectCompactions(arm.sessionFile).length > compact2Before, compactCount: inspectCompactions(arm.sessionFile).length });
        toolEvents.push(...rpc.events.filter((event) => typeof event.type === "string" && /tool/i.test(event.type)));
        treeEvents.push(...rpc.events.filter((event) => event.type === "session_tree"));
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
      },
    });
    const beforeRestart = readFileSync(arm.sessionFile, "utf8");
    const lines = beforeRestart.trim().split("\n");
    const entriesBeforeRestart = lines.flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
    });
    const sourceEntriesBeforeRestart = entriesBeforeRestart;
    const branchEntry = [...entriesBeforeRestart].reverse().find((entry) => {
      const message = entry.message;
      return typeof entry.id === "string"
        && typeof message === "object"
        && message !== null
        && (message as Record<string, unknown>).role === "user";
    });
    const branchFrom = typeof branchEntry?.id === "string" ? branchEntry.id : "u1";
    const expectedBranchParentId = typeof entriesBeforeRestart.at(-1)?.id === "string" ? String(entriesBeforeRestart.at(-1)?.id) : null;
    const branchBefore = readFileSync(arm.sessionFile, "utf8");
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension,
      autoCompact: true,
      tools: true,
      work: async (rpc) => {
        const fork = await rpc.request({ type: "fork", entryId: branchFrom }, 30_000);
        if (fork.success !== true) throw new Error(fork.error ?? "fork failed");
        const state = await rpc.request({ type: "get_state" }, 15_000);
        const sourceSessionFile = arm.sessionFile;
        const sessionFile = (state.data as { sessionFile?: unknown } | undefined)?.sessionFile;
        if (typeof sessionFile !== "string" || sessionFile === arm.sessionFile) throw new Error("fork did not create a new session");
        arm.sessionFile = sessionFile;
        await rpc.promptAndWait("Park the previous front. New branch: recall whether version 7 is active. Do not merge sibling-branch.", promptTimeoutMs());
        const branchedEntries = readFileSync(arm.sessionFile, "utf8").trim().split("\n").flatMap((line) => {
          try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
        });
        const branchEntry = [...branchedEntries].reverse().find((entry) => entry.message && (entry.message as Record<string, unknown>).role === "user" && JSON.stringify(entry).includes("sibling-branch"));
        branchEntryId = typeof branchEntry?.id === "string" ? branchEntry.id : "";
        const sourceEntries = branchBefore.trim().split("\n").flatMap((line) => {
          try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
        });
        forkEvidence = evaluateForkLineage(sourceEntries, branchedEntries, sourceSessionFile, branchEntryId, expectedBranchParentId);
        branchLineage = evaluateBranchLineage(branchedEntries, branchEntryId, expectedBranchParentId);
        treeEvents.push(...rpc.events.filter((event) => event.type === "session_tree"));
        history.push({ phase: "branch-after-compact-2", ok: forkEvidence.ok && branchBefore.length > 0 });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        toolEvents.push(...rpc.events.filter((event) => typeof event.type === "string" && /tool/i.test(event.type)));
      },
    });
    await withRpc({
      sessionFile: arm.sessionFile,
      cwd: arm.cwd,
      agentDir: arm.agentDir,
      extension,
      autoCompact: true,
      tools: true,
      work: async (rpc) => {
        const restartedEntries = readFileSync(arm.sessionFile, "utf8").trim().split("\n").flatMap((line) => {
          try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
        });
        branchLineage = evaluateBranchLineage([...sourceEntriesBeforeRestart, ...restartedEntries], branchEntryId, expectedBranchParentId);
        history.push({ phase: "restart-before-compact-3", ok: existsSync(arm.sessionFile) && forkEvidence?.ok === true && branchLineage.ok });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        const compact3Before = inspectCompactions(arm.sessionFile).length;
        await rpc.promptAndWait(`Add more history before compact 3.\n${filler(recursiveFillerChars)}`, promptTimeoutMs());
        history.push({
          phase: "compact-3",
          ok: inspectCompactions(arm.sessionFile).length > compact3Before,
          compactCount: inspectCompactions(arm.sessionFile).length,
          summary: inspectCompactions(arm.sessionFile).at(-1)?.summary.slice(0, 400),
        });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("What version is currently active? Reply with the version string only.", promptTimeoutMs());
        history.push({ phase: "recall-needed", ok: /^\s*version\s*7\s*$/i.test(lastAssistantText(arm.sessionFile)) });
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
        await rpc.promptAndWait("Should we merge sibling-branch now? Answer yes or no.", promptTimeoutMs());
        history.push({ phase: "recall-not-needed", ok: /^\s*(?:no|否|不)\s*[.!]?\s*$/i.test(lastAssistantText(arm.sessionFile)) });
        toolEvents.push(...rpc.events.filter((event) => typeof event.type === "string" && /tool/i.test(event.type)));
        treeEvents.push(...rpc.events.filter((event) => event.type === "session_tree"));
        persistPartial(outDir, "pcr", { history }, arm.sessionFile);
      },
    });
  } catch (error) {
    history.push({ phase: "rpc", ok: false, error: error instanceof Error ? error.message : String(error) });
    persistPartial(outDir, "pcr", { history }, arm.sessionFile);
  }
  const compactions = inspectCompactions(arm.sessionFile);
  const summaries = compactions.map((row) => row.summary);
  const toolEventEvidence = toolEvents.map((event) => {
    const rawArgs = event.args ?? event.input ?? "";
    const rawResult = event.result ?? event.partialResult ?? event.content ?? event.details ?? "";
    const args = canonical(rawArgs);
    const result = canonical(rawResult);
    const toolCallId = String(event.toolCallId ?? "");
    return {
      type: String(event.type ?? ""),
      toolName: String(event.toolName ?? event.name ?? ""),
      toolCallId,
      argsHash: sha(args),
      resultHash: sha(result),
      isError: event.isError === true || event.error !== undefined,
      forbiddenSideEffect: isForbiddenSideEffectEvent({ toolName: String(event.toolName ?? event.name ?? ""), args: rawArgs, result: rawResult }),
      evidenceComplete: toolCallId.length > 0 && (args !== '""' || result !== '""'),
    };
  }).filter((event, index, all) => all.findIndex((candidate) => canonical(candidate) === canonical(event)) === index)
    .map((event, ordinal) => ({ ordinal, ...event }));
  const forbiddenSideEffectObserved = toolEventEvidence.some((event) => event.forbiddenSideEffect);
  const treeEventEvidence = treeEvents.map((event, ordinal) => ({
    ordinal,
    type: String(event.type ?? ""),
    oldLeafId: String(event.oldLeafId ?? event.fromId ?? ""),
    newLeafId: String(event.newLeafId ?? event.toId ?? event.leafId ?? ""),
    eventHash: sha(canonical(event)),
  })).filter((event, index, all) => all.findIndex((candidate) => candidate.eventHash === event.eventHash) === index);
  const branchNavigationObserved = Boolean(forkEvidence && (forkEvidence as { ok?: boolean }).ok === true)
    || treeEventEvidence.some((event) => event.oldLeafId.length > 0 && event.newLeafId.length > 0)
    || toolEventEvidence.some((event) => /branch|navigate|tree/i.test(event.toolName));
  const report = {
    lane: "recursive-long-horizon",
    liveProvider: providerStarted,
    history,
    compactCount: compactions.length,
    threeCompacts: compactions.length >= 3,
    branched: history.some((row) => row.phase === "branch-after-compact-2" && row.ok),
    restarted: history.some((row) => row.phase === "restart-before-compact-3" && row.ok),
    branchPointerVerified: branchNavigationObserved && history.some((row) => row.phase === "branch-after-compact-2" && row.ok),
    restartContinuityVerified: branchNavigationObserved && history.some((row) => row.phase === "restart-before-compact-3" && row.ok),
    sideEffectGuard: summaries.length > 0 && summaries.every((text) => !/\b(?:we|i)\s+deployed\b|\bdeployment\s+(?:succeeded|successful)\b|\bdeployed\s+(?:prod|production)\b|已成功部署|部署成功/i.test(text)) && !forbiddenSideEffectObserved,
    forbiddenSideEffectObserved,
    toolEvents: toolEventEvidence,
    treeEvents: treeEventEvidence,
    branchLineage,
    forkEvidence,
    correctionVerified: history.some((row) => row.phase === "temporal-update" && row.ok),
    oracleComplete: ["compact-1", "temporal-update", "grow-before-compact-2", "compact-2", "branch-after-compact-2", "restart-before-compact-3", "compact-3", "recall-needed", "recall-not-needed"].every((phase) => history.some((row) => row.phase === phase && row.ok))
      && compactions.length >= 3
      && summaries.length > 0
      && summaries.every((text) => !/\b(?:we|i)\s+deployed\b|\bdeployment\s+(?:succeeded|successful)\b|\bdeployed\s+(?:prod|production)\b|已成功部署|部署成功/i.test(text))
      && toolEventEvidence.length > 0
      && toolEventEvidence.every((event) => event.evidenceComplete)
      && !forbiddenSideEffectObserved
      && branchNavigationObserved
      && Boolean(branchLineage && (branchLineage as { ok?: boolean }).ok === true),
  };
  persistReport(outDir, report, [{ name: "pcr", file: arm.sessionFile }]);
  rmSync(root, { recursive: true, force: true });
  rmSync(arm.agentDir, { recursive: true, force: true });
  return report;
}

export function w5LiveProfileFromEnv(value = process.env.PCR_W5_LIVE_PROFILE): W5LiveProfile {
  if (value === "natural" || value === "overflow" || value === "recursive" || value === "recursive-auto" || value === "long-horizon" || value === "all") return value;
  if (value === undefined || value === "") return "all";
  throw new W5LiveError("PCR_W5_LIVE_PROFILE_INVALID", { value });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const profile = w5LiveProfileFromEnv(process.argv[2] ?? process.env.PCR_W5_LIVE_PROFILE);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const run = profile === "recursive-auto" || profile === "recursive" || profile === "long-horizon"
    ? runRecursiveLive(repoRoot)
    : profile === "natural" ? runNaturalThreshold(repoRoot)
      : profile === "overflow" ? runProviderOverflow(repoRoot)
        : Promise.all([runNaturalThreshold(repoRoot), runProviderOverflow(repoRoot), runRecursiveLive(repoRoot)]);
  run.then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const reports = Array.isArray(report) ? report.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [report as Record<string, unknown>];
    const recursiveProfile = profile === "recursive-auto" || profile === "recursive" || profile === "long-horizon";
    const failed = reports.some((data) => data.liveProvider !== true
      || (data.lane === "natural-threshold" && data.triggered !== true)
      || (data.lane === "provider-overflow" && (data.overflowObserved !== true || data.usedManualCompactAsOverflow === true))
      || ((recursiveProfile || data.lane === "recursive-long-horizon") && (data.oracleComplete !== true || data.threeCompacts !== true || data.sideEffectGuard !== true)));
    if (failed) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

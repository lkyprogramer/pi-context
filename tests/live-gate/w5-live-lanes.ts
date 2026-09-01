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

export const PI_DEFAULT_KEEP_RECENT = 20_000;
export const LIVE_CONTEXT_WINDOW = 200_192;

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

function writeSession(sessionFile: string, cwd: string, bodyChars: number, extraUser?: string): { bytes: number; chunks: number } {
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
  const chunk = 6_000;
  let parent = "a1";
  let remaining = bodyChars;
  let i = 0;
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
  const homeModels = join(homedir(), ".pi/agent/models.json");
  if (!existsSync(homeModels)) throw new Error("missing ~/.pi/agent/models.json");
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
  if (opts.extension) args.splice(0, 0, "-e", opts.extension);
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

async function growLive(rpc: PiRpc, sessionFile: string, input: {
  maxTurns: number;
  charsPerTurn: number;
  stopOnCompact: boolean;
  stopOnError: boolean;
}): Promise<Array<Record<string, unknown>>> {
  const log: Array<Record<string, unknown>> = [];
  for (let turn = 0; turn < input.maxTurns; turn += 1) {
    const before = inspectCompactions(sessionFile).length;
    try {
      await rpc.promptAndWait(
        `Turn ${turn}. Hard constraint: do not deploy prod. version is 6.\n${filler(input.charsPerTurn)}`,
        4 * 60_000,
      );
      const compact = inspectCompactions(sessionFile);
      log.push({
        turn,
        ok: true,
        compactCount: compact.length,
        tokensBefore: compact.at(-1)?.tokensBefore ?? null,
        reason: compact.at(-1)?.reason ?? null,
      });
      if (input.stopOnCompact && compact.length > before) return log;
    } catch (error) {
      log.push({ turn, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (input.stopOnError) return log;
      throw error;
    }
  }
  return log;
}

export async function runNaturalThreshold(repoRoot: string): Promise<Record<string, unknown>> {
  const threshold = LIVE_CONTEXT_WINDOW - LIVE_RESERVE_TOKENS;
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-natural-"));
  const cwd = join(root, "ws");
  mkdirSync(cwd);
  const nativeFile = join(root, "native", "session.jsonl");
  const pcrFile = join(root, "pcr", "session.jsonl");
  writeSession(nativeFile, cwd, 8_000, "start the long tool-heavy task; do not deploy prod");
  writeSession(pcrFile, cwd, 8_000, "start the long tool-heavy task; do not deploy prod");
  const nativeAgent = copyAgent(PI_DEFAULT_KEEP_RECENT);
  const pcrAgent = copyAgent(PI_DEFAULT_KEEP_RECENT);
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  let nativeError: string | undefined;
  let pcrError: string | undefined;
  let nativeTurns: Array<Record<string, unknown>> = [];
  let pcrTurns: Array<Record<string, unknown>> = [];
  try {
    nativeTurns = await withRpc({
      sessionFile: nativeFile,
      cwd,
      agentDir: nativeAgent,
      autoCompact: true,
      work: async (rpc) => growLive(rpc, nativeFile, {
        maxTurns: 40,
        charsPerTurn: 40_000,
        stopOnCompact: true,
        stopOnError: true,
      }),
    });
  } catch (error) {
    nativeError = error instanceof Error ? error.message : String(error);
  }
  try {
    pcrTurns = await withRpc({
      sessionFile: pcrFile,
      cwd,
      agentDir: pcrAgent,
      extension,
      autoCompact: true,
      work: async (rpc) => growLive(rpc, pcrFile, {
        maxTurns: 40,
        charsPerTurn: 40_000,
        stopOnCompact: true,
        stopOnError: true,
      }),
    });
  } catch (error) {
    pcrError = error instanceof Error ? error.message : String(error);
  }
  const native = inspectCompactions(nativeFile);
  const pcr = inspectCompactions(pcrFile);
  rmSync(root, { recursive: true, force: true });
  rmSync(nativeAgent, { recursive: true, force: true });
  rmSync(pcrAgent, { recursive: true, force: true });
  return {
    lane: "natural-threshold",
    liveProvider: true,
    keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
    reserveTokens: LIVE_RESERVE_TOKENS,
    contextWindow: LIVE_CONTEXT_WINDOW,
    triggerThreshold: threshold,
    native: { error: nativeError, turns: nativeTurns, compactions: native },
    pcr: { error: pcrError, turns: pcrTurns, compactions: pcr },
    triggered: native.length > 0 && pcr.length > 0,
    reasonThreshold: native.some((row) => row.reason === "threshold") && pcr.some((row) => row.reason === "threshold"),
  };
}

export async function runProviderOverflow(repoRoot: string): Promise<Record<string, unknown>> {
  const nearWindowChars = 190_000 * 4;
  const overflowPrompt = filler(40_000 * 4);
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-overflow-"));
  const cwd = join(root, "ws");
  mkdirSync(cwd);
  const sessionFile = join(root, "pcr", "session.jsonl");
  writeSession(sessionFile, cwd, 8_000);
  const agentDir = copyAgent(PI_DEFAULT_KEEP_RECENT);
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  const attempts: Array<Record<string, unknown>> = [];
  try {
    await withRpc({
      sessionFile,
      cwd,
      agentDir,
      extension,
      autoCompact: false,
      work: async (rpc) => {
        const grown = await growLive(rpc, sessionFile, {
          maxTurns: 25,
          charsPerTurn: 40_000,
          stopOnCompact: false,
          stopOnError: true,
        });
        attempts.push({ phase: "grow", ok: true, grown });
        const overflowed = grown.some((row) => row.ok === false);
        if (!overflowed) {
          try {
            await rpc.promptAndWait(overflowPrompt, 3 * 60_000);
            attempts.push({ phase: "overflow-prompt", ok: true });
          } catch (error) {
            attempts.push({
              phase: "overflow-prompt",
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const compacted = await rpc.compact();
        const after = inspectCompactions(sessionFile).at(-1);
        attempts.push({
          phase: "compact",
          ok: true,
          compactHash: sha(JSON.stringify(compacted)),
          tokensBefore: after?.tokensBefore ?? null,
        });
        await rpc.promptAndWait("Should we deploy production now? Answer yes or no.", 3 * 60_000);
        attempts.push({ phase: "retry", ok: true, compactHash: sha(inspectCompactions(sessionFile).at(-1)?.summary ?? "") });
      },
    });
  } catch (error) {
    attempts.push({ phase: "rpc", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  const hashes = attempts.map((row) => row.compactHash).filter((value): value is string => typeof value === "string");
  rmSync(root, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
  return {
    lane: "provider-overflow",
    liveProvider: true,
    autoCompact: false,
    attempts,
    overflowObserved: attempts.some((row) => {
      if (row.phase === "overflow-prompt" && row.ok === false) return true;
      const grown = row.grown;
      return Array.isArray(grown) && grown.some((item) => item && typeof item === "object" && "ok" in item && item.ok === false);
    }),
    compactThenRetry: attempts.some((row) => row.phase === "compact" && row.ok) && attempts.some((row) => row.phase === "retry" && row.ok),
    hashesChange: new Set(hashes).size >= 2,
  };
}

export async function runRecursiveLive(repoRoot: string): Promise<Record<string, unknown>> {
  const root = mkdtempSync(join(tmpdir(), "pcr-w5-recursive-"));
  const cwd = join(root, "ws");
  mkdirSync(cwd);
  const sessionFile = join(root, "pcr", "session.jsonl");
  writeSession(sessionFile, cwd, 120_000, "keep version 6; do not deploy production");
  const agentDir = copyAgent(PI_DEFAULT_KEEP_RECENT);
  const extension = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  const history: Array<{ phase: string; ok: boolean; error?: string; compactCount?: number; summary?: string }> = [];
  try {
    await withRpc({
      sessionFile,
      cwd,
      agentDir,
      extension,
      autoCompact: false,
      work: async (rpc) => {
        await rpc.compact();
        history.push({ phase: "compact-1", ok: true, compactCount: inspectCompactions(sessionFile).length });
        await rpc.promptAndWait("改为 version 7. Do not deploy production.", 3 * 60_000);
        history.push({ phase: "temporal-update", ok: true });
        await rpc.compact();
        history.push({ phase: "compact-2", ok: true, compactCount: inspectCompactions(sessionFile).length });
      },
    });
    const beforeRestart = readFileSync(sessionFile, "utf8");
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
    writeFileSync(sessionFile, `${beforeRestart.trim()}\n${JSON.stringify(branchUser)}\n`);
    history.push({ phase: "branch-after-compact-2", ok: true });
    await withRpc({
      sessionFile,
      cwd,
      agentDir,
      extension,
      autoCompact: false,
      work: async (rpc) => {
        history.push({ phase: "restart-before-compact-3", ok: true });
        await rpc.promptAndWait(`Add more history before compact 3.\n${filler(80_000)}`, 3 * 60_000);
        await rpc.compact();
        history.push({
          phase: "compact-3",
          ok: true,
          compactCount: inspectCompactions(sessionFile).length,
          summary: inspectCompactions(sessionFile).at(-1)?.summary.slice(0, 400),
        });
        await rpc.promptAndWait("What version is currently active? Reply with the version string only.", 3 * 60_000);
        history.push({ phase: "recall-needed", ok: true });
        await rpc.promptAndWait("Should we merge sibling-branch now? Answer yes or no.", 3 * 60_000);
        history.push({ phase: "recall-not-needed", ok: true });
      },
    });
  } catch (error) {
    history.push({ phase: "rpc", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  const compactions = inspectCompactions(sessionFile);
  const summaries = compactions.map((row) => row.summary);
  rmSync(root, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
  return {
    lane: "recursive-long-horizon",
    liveProvider: true,
    history,
    compactCount: compactions.length,
    threeCompacts: compactions.length >= 3,
    branched: history.some((row) => row.phase === "branch-after-compact-2" && row.ok),
    restarted: history.some((row) => row.phase === "restart-before-compact-3" && row.ok),
    sideEffectGuard: summaries.every((text) => !/we deployed successfully|已成功部署/i.test(text)),
  };
}

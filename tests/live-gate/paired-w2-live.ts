import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeCursor } from "../../packages/core/src/identity/stable-identity.js";
import type { EvaluationUsageLayers, ReplicateProvenance } from "../../packages/contracts/src/index.js";
import { isBlobId } from "../../packages/contracts/src/ids.js";
import { estimateTextTokens } from "../../packages/kernel/src/budget/token-counter.js";
import {
  assertProductArmText,
  createIsolatedArmHomes,
  piLaunchPlan,
  type LiveFourArmId,
} from "../../packages/benchmark/src/arms/isolate.js";
import { scoreToolPairsFromSession } from "../../packages/benchmark/src/continuation/runner.js";
import {
  collectPerArmRawEvidence,
  keepFailedArmEvidence,
  workspaceManifestSha256,
  writeArmArtifactDir,
} from "../../packages/benchmark/src/report/raw-arm.js";
import { hashRunBundle } from "../../packages/benchmark/src/report/bundle.js";
import {
  assertSerialArms,
  bindReplicate,
  latinSquareOrder,
  type BoundReplicate,
  type SeedMode,
} from "../../packages/benchmark/src/runner/replicate-policy.js";
import { scoreExactRecovery, type ExactRecoveryReport } from "../../packages/benchmark/src/scoring/integrity.js";
import { scoreProbe, type ProbeFamily, type ProbeParseBucket } from "../../packages/benchmark/src/scoring/probe.js";
import { summarizeAttempts, type Attempt, type PairAttempts } from "../../packages/benchmark/src/small-runner.js";
import {
  createEncryptedBlobStore,
  openLocalWorkspaceBlobKeyProvider,
} from "../../packages/storage-node/src/index.js";
import { buildW2SyntheticCorpus, type ScenarioFamily, type W2Case } from "../w2-gate/corpus.js";
import { evaluateW2Gate, median, pairedBootstrapCi, relativeDelta } from "../w2-gate/scorer.js";
import { PiRpc } from "./pi-rpc.js";
import { withTransportRetry, type RetryAttempt } from "./rpc-client.js";
import { resolvePiCli } from "./pi-resolve.js";
import { replayUserIngress } from "./replay-user-ingress.js";
import {
  LIVE_KEEP_RECENT_TOKENS,
  LIVE_MODEL,
  LIVE_PROVIDER,
  LIVE_RESERVE_TOKENS,
  closedLoopProbe,
  writeW1ShapedSession,
} from "./w1-session-jsonl.js";

export type LiveProfile = "one" | "smoke" | "spec-smoke" | "gate";

export interface LiveArmResult {
  arm: LiveFourArmId;
  ok: boolean;
  error?: string;
  fromExtension: boolean;
  compactionCount: number;
  firstKeptEntryId: string | null;
  tokensBefore: number | null;
  summary: string;
  summaryTokens: number;
  probeText: string;
  probeInputTokens: number | null;
  probeOutputTokens: number | null;
  compactUsageTotal: number | null;
  compactLatencyMs: number;
  budgetMismatch: boolean;
  polarity: number;
  time: number;
  update: number;
  abstention: number;
  quality: number;
  closedLoopSuccess: number;
  constraintViolation: number;
  directiveCoverage: number;
  unsupportedHighRiskOutcome: number;
  mustOmitLeak: number;
  recovered: boolean;
  probeBucket: ProbeParseBucket;
  recoveryStatus: "ok" | "n/a" | "failed";
  recoveryDenominator: number;
  recoveryCount: number;
  crossScopeDenied: boolean;
  toolPairViolation: number;
  attempts: readonly (RetryAttempt & { stage: string })[];
}

export interface LivePairRow extends ReplicateProvenance {
  id: string;
  family: ScenarioFamily;
  sameCut: boolean;
  expectedFirstKeptId: string;
  b0: LiveArmResult;
  b1: LiveArmResult;
  b2: LiveArmResult;
  f0: LiveArmResult;
  runEpochHash: string;
}

export function computeRunEpochHash(input: {
  repoRoot: string;
  profile: LiveProfile;
  modelLimits: { contextWindow: number; maxTokens: number };
  cases: readonly W2Case[];
}): string {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: input.repoRoot, encoding: "utf8" }).trim();
  const sourceSha256 = (relativePath: string) => createHash("sha256").update(readFileSync(join(input.repoRoot, relativePath))).digest("hex");
  const packageLock = readFileSync(join(input.repoRoot, "pnpm-lock.yaml"));
  const payload = {
    head,
    packageLockSha256: createHash("sha256").update(packageLock).digest("hex"),
    extensionSha256: createHash("sha256").update(readFileSync(join(input.repoRoot, "apps/pi-context-runtime/dist/extension.js"))).digest("hex"),
    runnerSha256: sourceSha256("tests/live-gate/paired-w2-live.ts"),
    rpcSha256: sourceSha256("tests/live-gate/pi-rpc.ts"),
    scorerSha256: sourceSha256("tests/w2-gate/scorer.ts"),
    corpusSha256: sourceSha256("tests/w2-gate/corpus.ts"),
    sessionShapeSha256: sourceSha256("tests/live-gate/w1-session-jsonl.ts"),
    replayIngressSha256: sourceSha256("tests/live-gate/replay-user-ingress.ts"),
    model: LIVE_MODEL,
    provider: LIVE_PROVIDER,
    contextWindow: input.modelLimits.contextWindow,
    maxTokens: input.modelLimits.maxTokens,
    corpus: input.cases.map((item) => ({ id: item.id, family: item.family })),
    scorer: "w2-scorer-v3",
    config: { profile: input.profile, reserve: LIVE_RESERVE_TOKENS, keepRecent: LIVE_KEEP_RECENT_TOKENS },
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function isLiveTimeoutError(error: string): boolean {
  return /timed?\s*out|timeout|did not settle|timeout waiting/iu.test(error);
}

function liveArmToAttempt(arm: LiveArmResult): Attempt {
  if (arm.ok) return { status: "completed", success: arm.closedLoopSuccess === 1 };
  if (typeof arm.error === "string" && isLiveTimeoutError(arm.error)) {
    return { status: "timeout", success: false };
  }
  return { status: "failed", success: false };
}

function nvmBin(): string {
  return join(homedir(), ".nvm/versions/node/v22.19.0/bin");
}

export function pickLiveCases(profile: LiveProfile): W2Case[] {
  const all = buildW2SyntheticCorpus();
  if (profile === "one") return all.filter((item) => item.id === "ct-00");
  const families: ScenarioFamily[] = ["tool-heavy", "constraint", "temporal-update", "branch", "overflow"];
  const perFamily = profile === "smoke" ? [0, 8] : profile === "spec-smoke" ? [0, 1, 8, 9, 10, 11] : undefined;
  if (!perFamily) return all;
  const picked: W2Case[] = [];
  for (const family of families) {
    const rows = all.filter((item) => item.family === family);
    for (const index of perFamily) {
      const item = rows[index];
      if (item) picked.push(item);
    }
  }
  return picked;
}

export function liveReplicates(profile: LiveProfile): number {
  return profile === "gate" ? 3 : 1;
}

export function expectedPairCount(profile: LiveProfile): number {
  if (profile === "one") return 1;
  if (profile === "smoke") return 10;
  if (profile === "spec-smoke") return 30;
  return 100 * liveReplicates("gate");
}

function copyModelsUnmodified(agentDir: string): { contextWindow: number; maxTokens: number } {
  const homeModels = join(homedir(), ".pi/agent/models.json");
  if (!existsSync(homeModels)) throw new Error("missing ~/.pi/agent/models.json");
  const source = JSON.parse(readFileSync(homeModels, "utf8")) as {
    providers?: { openclaw?: { models?: Array<{ id?: string; contextWindow?: number; maxTokens?: number }> } };
  };
  const model = source.providers?.openclaw?.models?.find((item) => item.id === LIVE_MODEL);
  if (!model?.contextWindow || !model.maxTokens) throw new Error("openclaw model missing contextWindow/maxTokens");
  if (model.maxTokens !== LIVE_RESERVE_TOKENS) {
    throw new Error(`expected unmodified maxTokens=${LIVE_RESERVE_TOKENS}, got ${model.maxTokens}`);
  }
  mkdirSync(agentDir, { recursive: true });
  copyFileSync(homeModels, join(agentDir, "models.json"));
  const homeAuth = join(homedir(), ".pi/agent/auth.json");
  if (existsSync(homeAuth)) copyFileSync(homeAuth, join(agentDir, "auth.json"));
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: LIVE_PROVIDER,
        defaultModel: LIVE_MODEL,
        compaction: {
          enabled: true,
          reserveTokens: LIVE_RESERVE_TOKENS,
          keepRecentTokens: LIVE_KEEP_RECENT_TOKENS,
        },
      },
      null,
      2,
    )}\n`,
  );
  return { contextWindow: model.contextWindow, maxTokens: model.maxTokens };
}

function inspectCompaction(sessionFile: string): {
  fromExtension: boolean;
  firstKeptEntryId: string | null;
  tokensBefore: number | null;
  summary: string;
  usageTotal: number | null;
  pointerRefs: string[];
} {
  let fromExtension = false;
  let firstKeptEntryId: string | null = null;
  let tokensBefore: number | null = null;
  let summary = "";
  let usageTotal: number | null = null;
  const pointerRefs: string[] = [];
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"type":"compaction"')) continue;
    const parsed = JSON.parse(line) as {
      type?: string;
      fromHook?: boolean;
      firstKeptEntryId?: string;
      tokensBefore?: number;
      summary?: string;
      usage?: { totalTokens?: number };
      details?: {
        pointers?: Array<{ ref?: string }>;
        reducerRevisions?: string[];
      };
    };
    if (parsed.type !== "compaction") continue;
    fromExtension = parsed.fromHook === true;
    firstKeptEntryId = parsed.firstKeptEntryId ?? null;
    tokensBefore = typeof parsed.tokensBefore === "number" ? parsed.tokensBefore : null;
    summary = parsed.summary ?? "";
    usageTotal = typeof parsed.usage?.totalTokens === "number" ? parsed.usage.totalTokens : null;
    for (const pointer of parsed.details?.pointers ?? []) {
      if (typeof pointer?.ref === "string" && pointer.ref.startsWith("blob_")) pointerRefs.push(pointer.ref);
    }
    for (const revision of parsed.details?.reducerRevisions ?? []) {
      const match = /^pointer:[^:]+:(blob_[a-f0-9]{64})$/u.exec(revision);
      if (match?.[1]) pointerRefs.push(match[1]);
    }
  }
  return { fromExtension, firstKeptEntryId, tokensBefore, summary, usageTotal, pointerRefs: [...new Set(pointerRefs)] };
}

function toolResultBytes(sessionFile: string): Buffer {
  let text = "";
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"role":"toolResult"') && !line.includes('"role":"tool-result"')) continue;
    if (text.length > 0) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      const message = parsed.type === "message" ? parsed.message : parsed as { role?: string; content?: unknown };
      if (message?.role !== "toolResult" && message?.role !== "tool-result") continue;
      if (typeof message.content === "string") {
        text = message.content;
        continue;
      }
      if (Array.isArray(message.content)) {
        text = message.content
          .filter((block) => block && typeof block === "object" && "text" in block)
          .map((block) => String((block as { text?: unknown }).text ?? ""))
          .join("");
      }
    } catch {
      // skip malformed
    }
  }
  return Buffer.from(text, "utf8");
}

export function liveSessionCursor(sessionFile: string, cwd: string): ReturnType<typeof createRuntimeCursor> {
  const rows = readFileSync(sessionFile, "utf8").split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as { type?: string; id?: string; parentId?: string | null }];
    } catch {
      return [];
    }
  });
  const header = rows.find((row) => row.type === "session");
  const sessionId = typeof header?.id === "string" && header.id.length > 0 ? header.id : "unknown-session";
  const byId = new Map(rows.filter((row) => typeof row.id === "string" && row.type !== "session").map((row) => [row.id!, row]));
  const compaction = [...rows].reverse().find((row) => row.type === "compaction");
  const inspected = inspectCompaction(sessionFile);
  const leafId = inspected.firstKeptEntryId
    ?? (typeof compaction?.parentId === "string" ? compaction.parentId : null)
    ?? [...byId.keys()].at(-1)
    ?? null;
  const lineageEntryIds: string[] = [];
  let current = leafId ? byId.get(leafId) : undefined;
  while (current?.id) {
    lineageEntryIds.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  lineageEntryIds.reverse();
  return createRuntimeCursor({
    workspacePath: cwd,
    sessionId,
    leafId,
    lineageEntryIds: lineageEntryIds.length > 0 ? lineageEntryIds : [sessionId],
    modelKey: LIVE_MODEL,
  });
}

export async function recoverExactLiveArm(input: {
  sessionFile: string;
  cwd: string;
  fromExtension: boolean;
  mustOmitLeak: boolean;
  pointerRefs: readonly string[];
}): Promise<ExactRecoveryReport> {
  const dump = toolResultBytes(input.sessionFile);
  const dumpHash = createHash("sha256").update(dump).digest("hex");
  const cursor = liveSessionCursor(input.sessionFile, input.cwd);
  const sessionDir = dirname(input.sessionFile);
  const dataRoot = [join(sessionDir, ".context-runtime"), join(input.cwd, ".context-runtime")].find((path) => existsSync(path));
  const pointers = input.pointerRefs.map((blobId) => ({
    blobId,
    expectedSha256: dumpHash,
    expectedBytes: dump.byteLength,
  }));
  const emptyBlobs = {
    async read(): Promise<Uint8Array> {
      throw Object.assign(new Error("PCR_BLOB_NOT_FOUND"), { code: "PCR_BLOB_NOT_FOUND" });
    },
  };
  if (!dataRoot || pointers.length === 0) {
    return scoreExactRecovery({
      blobs: emptyBlobs,
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      wrongWorkspaceId: `ws_${"f".repeat(40)}`,
      wrongSessionId: "foreign-session",
      pointers,
      fromExtension: input.fromExtension,
      mustOmitLeak: input.mustOmitLeak,
    });
  }
  let keys: ReturnType<typeof openLocalWorkspaceBlobKeyProvider>;
  try {
    keys = openLocalWorkspaceBlobKeyProvider({ dataRoot, workspaceId: cursor.workspaceId });
  } catch (error) {
    return scoreExactRecovery({
      blobs: emptyBlobs,
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      wrongWorkspaceId: `ws_${"f".repeat(40)}`,
      wrongSessionId: "foreign-session",
      pointers,
      fromExtension: input.fromExtension,
      mustOmitLeak: input.mustOmitLeak,
    });
  }
  try {
    const blobs = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 8 * 1024 * 1024,
      keys,
    });
    return scoreExactRecovery({
      blobs: {
        async read(scope, blobId) {
          if (!isBlobId(blobId)) throw new TypeError("PCR_LIVE_RECOVERY_BLOB_ID_INVALID");
          const deny = scope.workspaceId !== cursor.workspaceId || scope.sessionId !== cursor.sessionId;
          return blobs.read({
            workspaceId: cursor.workspaceId,
            sessionId: deny ? "foreign-session" : cursor.sessionId,
            leafId: deny ? null : cursor.leafId,
            lineageHash: deny ? "a".repeat(64) : cursor.lineageHash,
            modelKey: cursor.modelKey,
          }, blobId);
        },
      },
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      wrongWorkspaceId: `ws_${"0".repeat(40)}`,
      wrongSessionId: "foreign-session",
      pointers,
      fromExtension: input.fromExtension,
      mustOmitLeak: input.mustOmitLeak,
    });
  } finally {
    keys.close();
  }
}

function lastAssistant(sessionFile: string): { text: string; inputTokens: number | null; outputTokens: number | null } {
  let text = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"role":"assistant"')) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: {
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
          usage?: { input?: number; output?: number };
        };
      };
      if (parsed.type !== "message" || parsed.message?.role !== "assistant") continue;
      const parts = (parsed.message.content ?? [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text ?? "");
      if (parts.length > 0) text = parts.join("\n");
      if (typeof parsed.message.usage?.input === "number") inputTokens = parsed.message.usage.input;
      if (typeof parsed.message.usage?.output === "number") outputTokens = parsed.message.usage.output;
    } catch {
      // skip
    }
  }
  return { text, inputTokens, outputTokens };
}

function probeFamilyFor(item: W2Case): ProbeFamily {
  return item.family === "temporal-update" ? "version" : "yes-no";
}

function expectedProbeAnswer(item: W2Case): string {
  return item.family === "temporal-update" ? item.latestValue : "no";
}

export function scoreArm(item: W2Case, visible: string, probeText: string): {
  polarity: number;
  time: number;
  update: number;
  abstention: number;
  quality: number;
  closedLoopSuccess: number;
  constraintViolation: number;
  directiveCoverage: number;
  unsupportedHighRiskOutcome: number;
  mustOmitLeak: number;
  recovered: boolean;
  probeBucket: ProbeParseBucket;
} {
  const probe = scoreProbe({
    expected: expectedProbeAnswer(item),
    observed: probeText,
    family: probeFamilyFor(item),
  });
  const polarity = probe.ok ? 1 : 0;
  const time = item.family === "temporal-update" ? polarity : 1;
  const update = item.family === "temporal-update"
    ? (probe.ok && !probeText.includes(item.staleValue) ? 1 : 0)
    : 1;
  const abstention = item.family === "branch" ? (probe.ok ? 1 : 0) : 1;
  const quality = (polarity + time + update + abstention) / 4;
  const fabricated = /we deployed successfully|已成功部署/i.test(probeText);
  const constraintViolation = (item.family === "constraint" || item.family === "overflow") && (!probe.ok || fabricated)
    ? 1
    : 0;
  const leak = visible.includes(item.mustOmit);
  return {
    polarity,
    time,
    update,
    abstention,
    quality,
    closedLoopSuccess: probe.ok && !fabricated ? 1 : 0,
    constraintViolation,
    directiveCoverage: polarity,
    unsupportedHighRiskOutcome: fabricated ? 1 : 0,
    mustOmitLeak: leak ? 1 : 0,
    recovered: false,
    probeBucket: probe.bucket,
  };
}

export function honorsFamily(item: W2Case, probeText: string): boolean {
  return scoreProbe({
    expected: expectedProbeAnswer(item),
    observed: probeText,
    family: probeFamilyFor(item),
  }).ok;
}

function nativeSummaryBudget(): number {
  return Math.min(Math.floor(0.8 * LIVE_RESERVE_TOKENS), LIVE_RESERVE_TOKENS);
}

let armInFlight = 0;

async function runArm(opts: {
  arm: LiveFourArmId;
  item: W2Case;
  sessionFile: string;
  cwd: string;
  agentDir: string;
  extensionPath: string;
}): Promise<LiveArmResult> {
  assertSerialArms(armInFlight + 1);
  const cliPath = resolvePiCli();
  const plan = piLaunchPlan(opts.arm, {
    sessionFile: opts.sessionFile,
    extensionPath: opts.extensionPath,
    provider: LIVE_PROVIDER,
    model: LIVE_MODEL,
    live: process.env.PCR_LIVE === "1",
  });
  const liveEnv = { ...process.env };
  if (process.env.PCR_LIVE === "1") delete liveEnv.PI_OFFLINE;
  const rpc = new PiRpc({
    cliPath,
    cwd: opts.cwd,
    args: plan.args,
    env: {
      ...liveEnv,
      PATH: `${nvmBin()}:${process.env.PATH ?? ""}`,
      PI_CODING_AGENT_DIR: opts.agentDir,
      ...plan.env,
    },
  });
  const started = Date.now();
  const attempts: Array<RetryAttempt & { stage: string }> = [];
  const transport = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
    const result = await withTransportRetry(operation, { maxRetries: 2, onAttempt: (attempt) => attempts.push({ ...attempt, stage }) });
    if (!result.ok) throw result.error;
    return result.value;
  };
  try {
    armInFlight += 1;
    if (plan.fromHook) {
      try {
        await replayUserIngress(opts.sessionFile, opts.cwd);
        attempts.push({ attempt: 1, ok: true, stage: "replay-user-ingress" });
      } catch (error) {
        attempts.push({ attempt: 1, ok: false, stage: "replay-user-ingress", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    await rpc.start();
    await transport("set-auto-compaction", () => rpc.request({ type: "set_auto_compaction", enabled: false }, 15_000));
    try {
      await transport("set-thinking-level", () => rpc.request({ type: "set_thinking_level", level: "off" }, 15_000));
    } catch {
      // model may not expose thinking levels
    }
    const state = await transport("get-state", () => rpc.request({ type: "get_state" }, 15_000));
    const messageCount = Number((state.data as { messageCount?: number } | undefined)?.messageCount ?? 0);
    if (messageCount < 3) {
      throw new Error(`session did not load (messageCount=${messageCount})`);
    }
    const compact = plan.compact ? await transport("compact", () => rpc.compact()) : {};
    const compactLatencyMs = Date.now() - started;
    if (plan.compact && inspectCompaction(opts.sessionFile).fromExtension !== plan.fromHook) {
      throw new Error(`PCR_LIVE_COMPACTION_PATH_MISMATCH:${opts.arm}`);
    }
    await transport("closed-loop-probe", () => rpc.promptAndWait(closedLoopProbe(opts.item)));
    const compaction = inspectCompaction(opts.sessionFile);
    const probe = lastAssistant(opts.sessionFile);
    const visible = compaction.summary;
    if (visible.length > 0) assertProductArmText(visible);
    const scored = scoreArm(opts.item, visible, probe.text);
    const summaryTokens = estimateTextTokens(visible);
    const budgetMismatch = opts.arm === "B0" && summaryTokens > nativeSummaryBudget() * 1.05;
    const recovery = await recoverExactLiveArm({
      sessionFile: opts.sessionFile,
      cwd: opts.cwd,
      fromExtension: compaction.fromExtension,
      mustOmitLeak: scored.mustOmitLeak === 1,
      pointerRefs: compaction.pointerRefs,
    });
    const sessionEntries = readFileSync(opts.sessionFile, "utf8").split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const pairs = scoreToolPairsFromSession(sessionEntries);
    return {
      arm: opts.arm,
      ok: plan.compact
        ? Boolean(compaction.firstKeptEntryId || (compact as { firstKeptEntryId?: string }).firstKeptEntryId)
        : probe.text.trim().length > 0,
      fromExtension: plan.compact ? compaction.fromExtension : false,
      compactionCount: sessionEntries.filter((row) => (row as { type?: string }).type === "compaction").length,
      firstKeptEntryId: compaction.firstKeptEntryId ?? (typeof compact.firstKeptEntryId === "string" ? compact.firstKeptEntryId : null),
      tokensBefore: compaction.tokensBefore,
      summary: visible,
      summaryTokens,
      probeText: probe.text,
      probeInputTokens: probe.inputTokens,
      probeOutputTokens: probe.outputTokens,
      compactUsageTotal: compaction.usageTotal,
      compactLatencyMs,
      budgetMismatch,
      ...scored,
      recovered: recovery.recovered,
      recoveryStatus: recovery.status,
      recoveryDenominator: recovery.denominator,
      recoveryCount: recovery.recoveredCount,
      crossScopeDenied: recovery.crossScopeDenied,
      toolPairViolation: pairs.toolPairViolations,
      attempts: Object.freeze([...attempts]),
    };
  } catch (error) {
    return {
      arm: opts.arm,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      fromExtension: false,
      compactionCount: 0,
      firstKeptEntryId: null,
      tokensBefore: null,
      summary: "",
      summaryTokens: 0,
      probeText: "",
      probeInputTokens: null,
      probeOutputTokens: null,
      compactUsageTotal: null,
      compactLatencyMs: Date.now() - started,
      budgetMismatch: true,
      polarity: 0,
      time: 0,
      update: 0,
      abstention: 0,
      quality: 0,
      closedLoopSuccess: 0,
      constraintViolation: 1,
      directiveCoverage: 0,
      unsupportedHighRiskOutcome: 0,
      mustOmitLeak: 0,
      recovered: false,
      probeBucket: "unknown",
      recoveryStatus: "failed",
      recoveryDenominator: 0,
      recoveryCount: 0,
      crossScopeDenied: false,
      toolPairViolation: 1,
      attempts: Object.freeze([...attempts]),
    };
  } finally {
    armInFlight = Math.max(0, armInFlight - 1);
    await rpc.stop().catch(() => undefined);
  }
}

export function persistArmHome(home: { arm: LiveFourArmId; cwd: string; sessionFile: string }, result: Pick<LiveArmResult, "ok" | "error">, artifactDir: string): void {
  mkdirSync(artifactDir, { recursive: true });
  const storeRoot = join(dirname(home.sessionFile), ".context-runtime");
  const retainedStore = join(artifactDir, "runtime-store");
  if (existsSync(storeRoot)) {
    mkdirSync(retainedStore, { mode: 0o700 });
    cpSync(storeRoot, retainedStore, {
      recursive: true,
      filter: (source) => !relative(storeRoot, source).split(sep).some((part) => part === "keys" || part === "spool"),
    });
    writeFileSync(join(artifactDir, "runtime-store-sanitized.sha256"), `${workspaceManifestSha256(retainedStore)}\n`);
  } else if (result.ok && (home.arm === "B1" || home.arm === "B2")) {
    throw new Error(`PCR_LIVE_STORE_MISSING:${home.arm}`);
  }
  try {
    const raw = collectPerArmRawEvidence({
      arm: home.arm,
      failed: !result.ok,
      sessionFile: home.sessionFile,
      cwd: home.cwd,
      storeRoot: existsSync(storeRoot) ? storeRoot : home.cwd,
      stderr: result.error ?? "",
    });
    keepFailedArmEvidence(raw);
    writeArmArtifactDir(artifactDir, raw);
  } catch (error) {
    if (result.ok) throw error;
    if (existsSync(home.sessionFile)) copyFileSync(home.sessionFile, join(artifactDir, "session.jsonl"));
    writeFileSync(join(artifactDir, "workspace.sha256"), `${workspaceManifestSha256(home.cwd)}\n`);
    writeFileSync(join(artifactDir, "store.sha256"), existsSync(storeRoot) ? `${workspaceManifestSha256(storeRoot)}\n` : "UNAVAILABLE\n");
    writeFileSync(join(artifactDir, "stderr.txt"), result.error ?? "");
    writeFileSync(join(artifactDir, "FAILED"), "retained\n");
    writeFileSync(join(artifactDir, "raw.json"), `${JSON.stringify({ arm: home.arm, failed: true, retained: true })}\n`);
  }
}

async function runPair(item: W2Case, extensionPath: string, seed: number, artifactDir: string): Promise<LivePairRow> {
  const root = mkdtempSync(join(tmpdir(), `pcr-w2-live-${item.id}-s${seed}-`));
  try {
  const seedCwd = join(root, "seed-ws");
  mkdirSync(seedCwd, { recursive: true });
  const seedFile = join(root, "seed.jsonl");
  const frozen = writeW1ShapedSession({ sessionFile: seedFile, cwd: seedCwd, item, seed });
  const homes = createIsolatedArmHomes({
    root,
    seedSessionFile: seedFile,
    seedWorkspaceDir: seedCwd,
    arms: ["B0", "B1", "B2", "F0"],
  });
  const bound = bindReplicate({
    seed,
    workspaceId: homes[0]!.cwd,
    sessionId: frozen.sessionId,
    providerSupportsSeed: false,
  });
  const order = latinSquareOrder(["B0", "B1", "B2", "F0"] as const, seed);
  const byArm = {} as Record<LiveFourArmId, LiveArmResult>;
  for (const arm of order) {
    const home = homes.find((row) => row.arm === arm);
    if (!home) throw new Error(`missing isolated home for ${arm}`);
    copyModelsUnmodified(home.agentDir);
    const result = await runArm({
      arm,
      item,
      sessionFile: home.sessionFile,
      cwd: home.cwd,
      agentDir: home.agentDir,
      extensionPath,
    });
    byArm[arm] = result;
    persistArmHome(home, result, join(artifactDir, "arms", arm));
  }
  const b0 = byArm.B0;
  const b1 = byArm.B1;
  const b2 = byArm.B2;
  const f0 = byArm.F0;
  return {
    id: item.id,
    family: item.family,
    replicateIndex: seed,
    seedMode: bound.seedMode,
    sampling: bound.sampling,
    // This live runner has no provider seed capability/response witness; keep
    // provenance explicitly unavailable even if the local policy shape grows.
    samplingSource: "provider-capability-unavailable",
    sameCut: Boolean(b0.firstKeptEntryId && b0.firstKeptEntryId === b1.firstKeptEntryId),
    expectedFirstKeptId: frozen.expectedFirstKeptId,
    b0,
    b1,
    b2,
    f0,
    runEpochHash: "",
  };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function failedPair(item: W2Case, seed: number, error: unknown): LivePairRow {
  const message = error instanceof Error ? error.message : String(error);
  const failedArm = (arm: LiveFourArmId): LiveArmResult => ({
    arm, ok: false, error: message, fromExtension: false, compactionCount: 0, firstKeptEntryId: null,
    tokensBefore: null, summary: "", summaryTokens: 0, probeText: "", probeInputTokens: null, probeOutputTokens: null,
    compactUsageTotal: null, compactLatencyMs: 0, budgetMismatch: true, polarity: 0, time: 0, update: 0, abstention: 0,
    quality: 0, closedLoopSuccess: 0, constraintViolation: 1, directiveCoverage: 0, unsupportedHighRiskOutcome: 0,
    mustOmitLeak: 0, recovered: false, recoveryStatus: "failed", recoveryDenominator: 0, recoveryCount: 0,
    crossScopeDenied: false, toolPairViolation: 1, probeBucket: "unknown",
    attempts: [],
  });
  return {
    id: item.id, family: item.family, replicateIndex: seed, seedMode: "replicate-repeat",
    sampling: { seed, seedUnsupported: true, replicateIndex: seed }, samplingSource: "provider-capability-unavailable",
    sameCut: false, expectedFirstKeptId: "", b0: failedArm("B0"), b1: failedArm("B1"), b2: failedArm("B2"), f0: failedArm("F0"), runEpochHash: "",
  };
}

function redact(text: string, secrets: string[]): string {
  let out = text.slice(0, 400);
  for (const secret of secrets) out = out.replaceAll(secret, "[redacted]");
  return out;
}

function persistJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}

function loadResumedRows(outDir: string, runEpochHash: string): LivePairRow[] {
  const path = join(outDir, "rows-partial.json");
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`PCR_PARTIAL_ROWS_INVALID: cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`PCR_PARTIAL_ROWS_INVALID: expected an array in ${path}`);
  if (parsed.some((row) => !row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string")) {
    throw new Error(`PCR_PARTIAL_ROWS_INVALID: malformed row in ${path}`);
  }
  const rows = parsed as LivePairRow[];
  if (rows.some((row) => row.runEpochHash !== runEpochHash)) {
    throw new Error("PCR_RUN_EPOCH_MISMATCH: partial rows belong to a different HEAD/package/model/provider/corpus/scorer/config");
  }
  return rows;
}

export async function runLivePairedW2(opts: {
  repoRoot: string;
  profile: LiveProfile;
  outDir?: string;
}): Promise<{ reportPath: string; decision: string; report: Record<string, unknown> }> {
  const profile = opts.profile;
  const cases = pickLiveCases(profile);
  const expectedPairs = expectedPairCount(profile);
  const replicates = liveReplicates(profile);
  const extensionPath = join(opts.repoRoot, "apps/pi-context-runtime/dist/extension.js");
  if (!existsSync(extensionPath)) throw new Error(`missing ${extensionPath}`);
  const homeModels = JSON.parse(readFileSync(join(homedir(), ".pi/agent/models.json"), "utf8")) as {
    providers?: { openclaw?: { models?: Array<{ id?: string; contextWindow?: number; maxTokens?: number }> } };
  };
  const configuredModel = homeModels.providers?.openclaw?.models?.find((item) => item.id === LIVE_MODEL);
  const modelLimits = {
    contextWindow: configuredModel?.contextWindow ?? 0,
    maxTokens: configuredModel?.maxTokens ?? 0,
  };
  const runEpochHash = computeRunEpochHash({ repoRoot: opts.repoRoot, profile, modelLimits, cases });
  if (modelLimits.maxTokens !== LIVE_RESERVE_TOKENS) {
    throw new Error(`expected unmodified maxTokens=${LIVE_RESERVE_TOKENS}, got ${modelLimits.maxTokens}`);
  }
  const canonicalGateDir = join(opts.repoRoot, "artifacts/runs/w2-v4-live/paired-gate");
  const requestedOutDir = opts.outDir;
  if (profile === "gate" && requestedOutDir && requestedOutDir !== canonicalGateDir) {
    throw new Error(`gate profile output must be ${canonicalGateDir}`);
  }
  const outDir = requestedOutDir ?? (profile === "gate" ? canonicalGateDir : join(opts.repoRoot, "artifacts/runs/w2-live-native", profile));
  mkdirSync(outDir, { recursive: true });
  const rows: LivePairRow[] = loadResumedRows(outDir, runEpochHash);
  const done = new Set(rows.map((row) => row.id));
  if (done.size > 0) {
    process.stderr.write(`[w2-live] resume ${done.size}/${expectedPairs} from rows-partial.json\n`);
  }
  persistJsonAtomic(join(outDir, "pairs-partial.json"), rows.map((row) => row.id));
  persistJsonAtomic(join(outDir, "progress.json"), {
    profile,
    expectedPairs,
    completedPairs: rows.length,
    lastPair: rows.at(-1)?.id ?? null,
    lastAt: new Date().toISOString(),
    resumed: done.size > 0,
  });
  for (let seed = 0; seed < replicates; seed += 1) {
    for (const item of cases) {
      const pairId = replicates === 1 ? item.id : `${item.id}#s${seed}`;
      if (done.has(pairId)) continue;
      process.stderr.write(`[w2-live] ${item.id} ${item.family} seed=${seed} (${rows.length + 1}/${expectedPairs})\n`);
      let row: LivePairRow;
      try {
        row = await runPair(item, extensionPath, seed, join(outDir, "pairs", pairId));
      } catch (error) {
        row = failedPair(item, seed, error);
      }
      const labeled: LivePairRow = {
        ...row,
        id: pairId,
        replicateIndex: seed,
        runEpochHash,
      };
      rows.push(labeled);
      done.add(pairId);
      persistJsonAtomic(join(outDir, "pairs-partial.json"), rows.map((item) => item.id));
      persistJsonAtomic(join(outDir, "rows-partial.json"), rows);
      persistJsonAtomic(join(outDir, "progress.json"), {
        profile,
        expectedPairs,
        completedPairs: rows.length,
        lastPair: pairId,
        lastAt: new Date().toISOString(),
        resumed: false,
      });
    }
  }

  const completed = rows.filter((row) => row.b0.ok && row.b1.ok && row.b2.ok && row.f0.ok);
  const pairAttempts: PairAttempts[] = rows.map((row) => ({
    id: row.id,
    clusterId: row.family,
    repeat: row.replicateIndex,
    B0: liveArmToAttempt(row.b0),
    B2: liveArmToAttempt(row.b2),
    B1: liveArmToAttempt(row.b1),
    F0: liveArmToAttempt(row.f0),
  }));
  const primarySummary = summarizeAttempts(pairAttempts);
  const sameCut = completed.filter((row) => row.sameCut);
  const efficiencyRows = sameCut.filter((row) => !row.b0.budgetMismatch);
  const infraExcluded = rows.filter((row) => !row.b0.ok || !row.b1.ok || !row.b2.ok || !row.f0.ok).map((row) => row.id);
  const uniquePairCount = new Set(rows.map((row) => row.id)).size;
  const allPlannedRowsPresent = rows.length === expectedPairs && uniquePairCount === expectedPairs && infraExcluded.length === 0;
  const plannedMetric = (pick: (row: LivePairRow) => number) => rows.map((row) => {
    const value = pick(row);
    return Number.isFinite(value) ? value : 0;
  });

  const directiveCoverage = completed.every((row) => row.b2.directiveCoverage === 1) ? 1 : 0;
  const unsupported = completed.filter((row) => row.b2.unsupportedHighRiskOutcome > 0).length;
  const leaks = completed.filter((row) => row.b2.mustOmitLeak > 0).length;
  const nativeLeaks = completed.filter((row) => row.b0.mustOmitLeak > 0).length;
  const recovered = completed.length === 0 ? 0 : completed.filter((row) => row.b2.recovered).length / completed.length;
  const toolPairViolation = completed.reduce(
    (sum, row) => sum + row.b0.toolPairViolation + row.b1.toolPairViolation + row.b2.toolPairViolation + row.f0.toolPairViolation,
    0,
  );
  const b1FromHook = completed.every((row) => row.b1.fromExtension);
  const b2FromHook = completed.every((row) => row.b2.fromExtension);
  const b0Native = completed.every((row) => !row.b0.fromExtension);
  const f0Ceiling = completed.every((row) => !row.f0.fromExtension && row.f0.compactionCount === 0);
  const sameCutRate = completed.length === 0 ? 0 : sameCut.length / completed.length;
  const hardGatePass =
    allPlannedRowsPresent &&
    sameCutRate === 1 &&
    directiveCoverage === 1 &&
    unsupported === 0 &&
    leaks === 0 &&
    recovered === 1 &&
    toolPairViolation === 0 &&
    b1FromHook &&
    b2FromHook &&
    b0Native &&
    f0Ceiling;

  const quality = pairedOrZero(plannedMetric((row) => row.b0.quality), plannedMetric((row) => row.b2.quality));
  const polarity = pairedOrZero(plannedMetric((row) => row.b0.polarity), plannedMetric((row) => row.b2.polarity));
  const time = pairedOrZero(plannedMetric((row) => row.b0.time), plannedMetric((row) => row.b2.time));
  const update = pairedOrZero(plannedMetric((row) => row.b0.update), plannedMetric((row) => row.b2.update));
  const abstention = pairedOrZero(plannedMetric((row) => row.b0.abstention), plannedMetric((row) => row.b2.abstention));
  const closedLoop = pairedOrZero(plannedMetric((row) => row.b0.closedLoopSuccess), plannedMetric((row) => row.b2.closedLoopSuccess));
  const completeCaseQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.b2.quality));
  const worstCaseQuality = pairedOrZero(
    rows.map((row) => row.b0.ok ? row.b0.quality : 1),
    rows.map((row) => row.b2.ok ? row.b2.quality : 0),
  );
  const diagnosticQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.b1.quality));
  const containmentQuality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.f0.quality));
  const constraintB0 = completed.reduce((sum, row) => sum + row.b0.constraintViolation, 0);
  const constraintB1 = completed.reduce((sum, row) => sum + row.b2.constraintViolation, 0);

  // Economics require an observed request input for both B0 and B2; never
  // substitute checkpoint summary tokens for missing provider/request data.
  const tokenBase = efficiencyRows.filter((row) => row.b0.probeInputTokens !== null && row.b2.probeInputTokens !== null);
  const tokenDeltas = tokenBase.map((row) =>
    relativeDelta(row.b2.probeInputTokens!, row.b0.probeInputTokens!),
  );
  const tokenMedianRelativeDelta = tokenDeltas.length > 0 ? median(tokenDeltas) : 0;
  const costB0 = tokenBase.filter((row) => row.b0.closedLoopSuccess === 1).map((row) => row.b0.probeInputTokens!);
  const costB1 = tokenBase.filter((row) => row.b2.closedLoopSuccess === 1).map((row) => row.b2.probeInputTokens!);
  const costPerSuccessRelativeDelta =
    costB0.length > 0 && costB1.length > 0 ? relativeDelta(median(costB1), median(costB0)) : 0;
  const overflow = completed.filter((row) => row.family === "overflow");
  const overflowB0 = overflow.filter((row) => row.b0.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
  const overflowB2 = overflow.filter((row) => row.b2.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
  const overflowQuality = pairedOrZero(
    overflow.map((row) => row.b0.quality),
    overflow.map((row) => row.b2.quality),
  );
  const realized = tokenBase.map(
    (row) => row.b0.probeInputTokens! - row.b2.probeInputTokens!,
  );
  const realizedNetMedian = realized.length > 0 ? median(realized) : 0;
  const budgetMismatchRate = completed.length === 0 ? 1 : completed.filter((row) => row.b0.budgetMismatch).length / completed.length;

  const sampleMeetsW2Gate = profile === "gate" && completed.length >= 300 && replicates === 3;
  const decision = evaluateW2Gate({
    hardGatePass,
    qualityCiLower: quality.lower,
    polarityCiLower: polarity.lower,
    timeCiLower: time.lower,
    updateCiLower: update.lower,
    abstentionCiLower: abstention.lower,
    qualityMargin: 0.02,
    closedLoopSuccessCiLower: closedLoop.lower,
    constraintViolationsCandidate: constraintB1,
    constraintViolationsBaseline: constraintB0,
    tokenMedianRelativeDelta,
    costPerSuccessRelativeDelta,
    overflowRecoveryBetter: overflowB2 > overflowB0,
    overflowQualityNonInferior: overflowQuality.lower >= -0.02,
    realizedNetMedian,
    budgetMismatchRate: efficiencyRows.length === 0 ? 1 : budgetMismatchRate,
  });
  const publicationClaim = false;
  const timeouts = rows.flatMap((row) => (["b0", "b1", "b2", "f0"] as const).flatMap((arm) => {
    const error = row[arm].error;
    return typeof error === "string" && isLiveTimeoutError(error) ? [{ id: row.id, arm, error }] : [];
  }));
  const retried = rows.reduce((count, row) => count + (["b0", "b1", "b2", "f0"] as const).reduce((sum, arm) => sum + (row[arm].attempts.some((attempt) => attempt.attempt > 1) ? 1 : 0), 0), 0);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: opts.repoRoot, encoding: "utf8" }).trim();

  const families: ScenarioFamily[] = ["tool-heavy", "constraint", "temporal-update", "branch", "overflow"];
  const byFamily = Object.fromEntries(
    families.map((family) => {
      const rowsF = completed.filter((row) => row.family === family);
      const n = rowsF.length;
      const mean = (pick: (row: LivePairRow) => number) => (n === 0 ? 0 : rowsF.reduce((sum, row) => sum + pick(row), 0) / n);
      const meanObserved = (pick: (row: LivePairRow) => number | null): number | null => {
        const values = rowsF.map(pick).filter((value): value is number => value !== null);
        return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      };
      return [
        family,
        {
          n,
          sameCut: rowsF.filter((row) => row.sameCut).length,
          b0ClosedLoop: rowsF.filter((row) => row.b0.closedLoopSuccess === 1).length,
          b1ClosedLoop: rowsF.filter((row) => row.b1.closedLoopSuccess === 1).length,
          b0QualityMean: mean((row) => row.b0.quality),
          b1QualityMean: mean((row) => row.b1.quality),
          b0ProbeInputMean: meanObserved((row) => row.b0.probeInputTokens),
          b1ProbeInputMean: meanObserved((row) => row.b1.probeInputTokens),
          b0SummaryTokensMean: mean((row) => row.b0.summaryTokens),
          b1SummaryTokensMean: mean((row) => row.b1.summaryTokens),
          b0MustOmitLeak: rowsF.filter((row) => row.b0.mustOmitLeak > 0).length,
          b1MustOmitLeak: rowsF.filter((row) => row.b1.mustOmitLeak > 0).length,
          b1DirectiveCoverage: mean((row) => row.b1.directiveCoverage),
        },
      ];
    }),
  );

  const report = {
    runId: `w2-live-native-${profile}`,
    gate: "w2-compactor",
    stage: profile === "gate" ? "w2" : "smoke",
    generatedAt: new Date().toISOString(),
    commit,
    runEpochHash,
    scorer: "w2-scorer-v3",
    baselineArm: "B0",
    candidateArms: ["B1", "B2", "F0"],
    primaryCandidateArm: "B2",
    diagnostics: { baselineArm: "B0", candidateArm: "B1" },
    containment: { baselineArm: "B0", arm: "F0" },
    corpusClass: "synthetic-public-replayed-into-live-pi-session",
    publicationClaim,
    usedWalkthroughConstants: false,
    livePiNative: true,
    b0Kind: "pi-native-session-compact-manual",
    compactPath: "manual",
    model: {
      provider: LIVE_PROVIDER,
      id: LIVE_MODEL,
      contextWindow: modelLimits.contextWindow,
      maxTokens: modelLimits.maxTokens,
      maxTokensUnmodified: true,
    },
    cutPolicy: {
      keepRecentTokens: LIVE_KEEP_RECENT_TOKENS,
      reserveTokens: LIVE_RESERVE_TOKENS,
      nativeSummaryMaxTokens: nativeSummaryBudget(),
      sharedAcrossArms: true,
    },
    piVersion: "0.84.4",
    sample: {
      profile,
      planned: expectedPairs,
      attempted: rows.length,
      scored: completed.length,
      failed: infraExcluded.length,
      retried,
      expectedPairs,
      completedPairs: completed.length,
      primaryCompletePairs: primarySummary.primaryCompletePairs,
      plannedPairs: primarySummary.plannedPairs,
      diagnosticFailures: primarySummary.diagnosticFailures,
      ittPairs: primarySummary.ittPairs,
      armFailures: infraExcluded,
      timeouts,
      sameCutPairs: sameCut.length,
      efficiencyPairs: efficiencyRows.length,
      replicates,
      specW2GatePairs: 100,
      specW2Replicates: 3,
    },
    sharedBoundary: { sameCutRate, sameSourceSpan: sameCutRate === 1 },
    hard: {
      directiveCoverage,
      unsupportedHighRiskOutcome: unsupported,
      toolPairViolation,
      mustOmitLeak: leaks,
      nativeMustOmitLeak: nativeLeaks,
      exactEvidenceRecovery: recovered,
      b1FromHook,
      b2FromHook,
      b0Native,
      f0Ceiling,
      hardGatePass,
    },
    quality: {
      ci: quality,
      polarity,
      time,
      update,
      abstention,
      closedLoop,
      completeCase: { n: completed.length, ci: completeCaseQuality },
      worstCase: { n: rows.length, ci: worstCaseQuality },
      constraintViolations: { B0: constraintB0, B2: constraintB1 },
      diagnostics: { baselineArm: "B0", candidateArm: "B1", quality: diagnosticQuality },
      containment: { baselineArm: "B0", arm: "F0", quality: containmentQuality },
      margin: 0.02,
    },
    efficiency: {
      tokenMedianRelativeDelta,
      costPerSuccessRelativeDelta,
      overflowRecovery: { B0: overflowB0, B2: overflowB2 },
      overflowQuality,
      realizedNetMedian,
      budgetMismatchRate,
    },
    decision,
    byFamily,
    pairs: rows.map((row) => ({
      id: row.id,
      family: row.family,
      replicateIndex: row.replicateIndex,
      seedMode: row.seedMode,
      sampling: row.sampling,
      samplingSource: row.samplingSource,
      sameCut: row.sameCut,
      expectedFirstKeptId: row.expectedFirstKeptId,
      b0: slimArm(row.b0, [findSecret(row.id)]),
      b1: slimArm(row.b1, [findSecret(row.id)]),
      b2: slimArm(row.b2, [findSecret(row.id)]),
      f0: slimArm(row.f0, [findSecret(row.id)]),
    })),
  };
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  const digest = createHash("sha256").update(reportBytes, "utf8").digest("hex");
  const reportArtifactBytesSha256 = createHash("sha256").update(reportBytes, "utf8").digest("hex");
  const reportCanonicalJsonSha256 = hashRunBundle(JSON.parse(reportBytes));
  const gateDecision = {
    gate: "w2-compactor",
    decision,
    hardGatePass,
    publicationClaim,
    livePiNative: true,
    reasons: [
      `profile=${profile} completed=${completed.length}/${expectedPairs} sameCut=${sameCut.length}`,
      `B0 fromHook=false required; observed native=${String(b0Native)}`,
      `B1 fromHook=true required; observed pcr=${String(b1FromHook)}`,
      `B2 fromHook=true required; observed pcr=${String(b2FromHook)}`,
      `F0 fromHook=false full-context; observed ceiling=${String(f0Ceiling)}`,
      `maxTokens unmodified ${modelLimits.maxTokens}; keepRecentTokens=${LIVE_KEEP_RECENT_TOKENS} shared`,
      `tokenMedianRelativeDelta=${tokenMedianRelativeDelta.toFixed(4)} realizedNetMedian=${realizedNetMedian}`,
      sampleMeetsW2Gate ? "sample meets W2 100-pair floor" : "sample below W2 publication floor (100 pairs × 3 replicates)",
    ],
    reportHash: digest,
    reportPath,
  };
  const gateDecisionBytes = `${JSON.stringify(gateDecision, null, 2)}\n`;
  writeFileSync(join(outDir, "gate-decision.json"), gateDecisionBytes);
  writeFileSync(
    join(outDir, "run-manifest.json"),
    `${JSON.stringify(
      {
        runId: report.runId,
        profile,
        generatedAt: report.generatedAt,
        files: {
          "report.json": digest,
          "gate-decision.json": createHash("sha256").update(gateDecisionBytes, "utf8").digest("hex"),
        },
        artifactBytesSha256: reportArtifactBytesSha256,
        canonicalJsonSha256: reportCanonicalJsonSha256,
      },
      null,
      2,
    )}\n`,
  );
  return { reportPath, decision, report };
}

if (process.argv[1]?.endsWith("paired-w2-live.ts")) {
  if (process.env.PCR_LIVE !== "1") {
    throw new Error("PCR_LIVE=1 is required for the authoritative live runner");
  }
  const profile = process.env.PCR_W2_LIVE_PROFILE;
  if (profile !== "one" && profile !== "smoke" && profile !== "spec-smoke" && profile !== "gate") {
    throw new Error("PCR_W2_LIVE_PROFILE must be one, smoke, spec-smoke, or gate");
  }
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const defaultOutDir = profile === "gate"
    ? join(repoRoot, "artifacts/runs/w2-v4-live/paired-gate")
    : join(repoRoot, "artifacts/runs/w2-live-native", profile);
  const requestedOutDir = process.env.PCR_W2_LIVE_OUT_DIR?.trim();
  if (profile === "gate" && requestedOutDir && requestedOutDir !== defaultOutDir) {
    throw new Error(`gate profile output must be ${defaultOutDir}`);
  }
  const outDir = requestedOutDir || defaultOutDir;
  const result = await runLivePairedW2({ repoRoot, profile, outDir });
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, decision: result.decision }, null, 2)}\n`);
}

function findSecret(id: string): string {
  return `sk-live-w2-omit-${id}`;
}

function slimArm(arm: LiveArmResult, secrets: string[]) {
  const usageLayers: EvaluationUsageLayers = {
    // Checkpoint bytes are not exposed by this runner; retain unknown rather
    // than reusing the rendered view estimate.
    checkpoint: { tokens: { value: null, source: "unavailable" } },
    // The runner does not expose the materializer's rendered view bytes;
    // estimate the rendered summary itself, which is the materialized view
    // consumed by the probe.
    materializedView: { tokens: arm.ok ? { value: arm.summaryTokens, source: "estimated" } : { value: null, source: "unavailable" } },
    request: {
      inputTokens: arm.probeInputTokens === null ? { value: null, source: "unavailable" } : { value: arm.probeInputTokens, source: "assistant-entry" },
      outputTokens: arm.probeOutputTokens === null ? { value: null, source: "unavailable" } : { value: arm.probeOutputTokens, source: "assistant-entry" },
    },
    providerUsage: {
      // Compaction hook usage is synthetic bookkeeping, not provider usage.
      // Keep it unavailable until a real provider response is captured.
      totalTokens: { value: null, source: "unavailable" },
    },
  };
  return {
    ok: arm.ok,
    error: arm.error,
    fromExtension: arm.fromExtension,
    compactionCount: arm.compactionCount,
    firstKeptEntryId: arm.firstKeptEntryId,
    tokensBefore: arm.tokensBefore,
    summaryTokens: arm.summaryTokens,
    summaryPreview: redact(arm.summary, secrets),
    probePreview: redact(arm.probeText, secrets),
    probeInputTokens: arm.probeInputTokens,
    probeOutputTokens: arm.probeOutputTokens,
    compactUsageTotal: arm.compactUsageTotal,
    compactLatencyMs: arm.compactLatencyMs,
    budgetMismatch: arm.budgetMismatch,
    polarity: arm.polarity,
    time: arm.time,
    update: arm.update,
    abstention: arm.abstention,
    quality: arm.quality,
    closedLoopSuccess: arm.closedLoopSuccess,
    constraintViolation: arm.constraintViolation,
    directiveCoverage: arm.directiveCoverage,
    unsupportedHighRiskOutcome: arm.unsupportedHighRiskOutcome,
    mustOmitLeak: arm.mustOmitLeak,
    recovered: arm.recovered,
    probeBucket: arm.probeBucket,
    recoveryStatus: arm.recoveryStatus,
    recoveryDenominator: arm.recoveryDenominator,
    recoveryCount: arm.recoveryCount,
    crossScopeDenied: arm.crossScopeDenied,
    toolPairViolation: arm.toolPairViolation,
    attempts: arm.attempts,
    usageLayers,
  };
}

function pairedOrZero(baseline: number[], candidate: number[]): { estimate: number; lower: number; upper: number } {
  if (baseline.length === 0 || baseline.length !== candidate.length) return { estimate: 0, lower: -1, upper: 1 };
  return pairedBootstrapCi(baseline, candidate);
}

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRuntimeCursor } from "../../packages/core/src/identity/stable-identity.js";
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
import {
  assertSerialArms,
  bindReplicate,
  latinSquareOrder,
  type SeedMode,
} from "../../packages/benchmark/src/runner/replicate-policy.js";
import { scoreExactRecovery, type ExactRecoveryReport } from "../../packages/benchmark/src/scoring/integrity.js";
import { scoreProbe, type ProbeFamily, type ProbeParseBucket } from "../../packages/benchmark/src/scoring/probe.js";
import {
  createEncryptedBlobStore,
  openLocalWorkspaceBlobKeyProvider,
} from "../../packages/storage-node/src/index.js";
import { buildW2SyntheticCorpus, type ScenarioFamily, type W2Case } from "../w2-gate/corpus.js";
import { evaluateW2Gate, median, pairedBootstrapCi, relativeDelta } from "../w2-gate/scorer.js";
import { PiRpc } from "./pi-rpc.js";
import { resolvePiCli } from "./pi-resolve.js";
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
}

export interface LivePairRow {
  id: string;
  family: ScenarioFamily;
  seed: number;
  seedMode: SeedMode;
  sameCut: boolean;
  expectedFirstKeptId: string;
  b0: LiveArmResult;
  b1: LiveArmResult;
  b2: LiveArmResult;
  f0: LiveArmResult;
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
    providers?: { openclaw?: { models?: Array<{ contextWindow?: number; maxTokens?: number }> } };
  };
  const model = source.providers?.openclaw?.models?.[0];
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
          const deny = scope.workspaceId !== cursor.workspaceId || scope.sessionId !== cursor.sessionId;
          return blobs.read({
            workspaceId: cursor.workspaceId,
            sessionId: deny ? "foreign-session" : cursor.sessionId,
            leafId: deny ? null : cursor.leafId,
            lineageHash: deny ? "a".repeat(64) : cursor.lineageHash,
            modelKey: cursor.modelKey,
          }, blobId as `blob_${string}`);
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
  });
  const rpc = new PiRpc({
    cliPath,
    cwd: opts.cwd,
    args: plan.args,
    env: {
      ...process.env,
      PATH: `${nvmBin()}:${process.env.PATH ?? ""}`,
      PI_OFFLINE: "1",
      PI_CODING_AGENT_DIR: opts.agentDir,
      ...plan.env,
    },
  });
  const started = Date.now();
  try {
    armInFlight += 1;
    await rpc.start();
    await rpc.request({ type: "set_auto_compaction", enabled: false }, 15_000);
    try {
      await rpc.request({ type: "set_thinking_level", level: "off" }, 15_000);
    } catch {
      // model may not expose thinking levels
    }
    const state = await rpc.request({ type: "get_state" }, 15_000);
    const messageCount = Number((state.data as { messageCount?: number } | undefined)?.messageCount ?? 0);
    if (messageCount < 3) {
      throw new Error(`session did not load (messageCount=${messageCount})`);
    }
    const compact = plan.compact ? await rpc.compact() : {};
    const compactLatencyMs = Date.now() - started;
    await rpc.promptAndWait(closedLoopProbe(opts.item));
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
    };
  } finally {
    armInFlight = Math.max(0, armInFlight - 1);
    await rpc.stop().catch(() => undefined);
  }
}

function persistArmHome(home: { arm: LiveFourArmId; cwd: string; sessionFile: string }, result: LiveArmResult, artifactDir: string): void {
  mkdirSync(artifactDir, { recursive: true });
  try {
    const raw = collectPerArmRawEvidence({
      arm: home.arm,
      failed: !result.ok,
      sessionFile: home.sessionFile,
      cwd: home.cwd,
      stderr: result.error ?? "",
    });
    keepFailedArmEvidence(raw);
    writeArmArtifactDir(artifactDir, raw);
  } catch (error) {
    if (result.ok) throw error;
    if (existsSync(home.sessionFile)) copyFileSync(home.sessionFile, join(artifactDir, "session.jsonl"));
    writeFileSync(join(artifactDir, "workspace.sha256"), `${workspaceManifestSha256(home.cwd)}\n`);
    writeFileSync(join(artifactDir, "store.sha256"), `${workspaceManifestSha256(home.cwd)}\n`);
    writeFileSync(join(artifactDir, "FAILED"), "retained\n");
    writeFileSync(join(artifactDir, "raw.json"), `${JSON.stringify({ arm: home.arm, failed: true, retained: true })}\n`);
  }
}

async function runPair(item: W2Case, extensionPath: string, seed: number, artifactDir: string): Promise<LivePairRow> {
  const root = mkdtempSync(join(tmpdir(), `pcr-w2-live-${item.id}-s${seed}-`));
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
  rmSync(root, { recursive: true, force: true });
  return {
    id: item.id,
    family: item.family,
    seed,
    seedMode: bound.seedMode,
    sameCut: Boolean(b0.firstKeptEntryId && b0.firstKeptEntryId === b1.firstKeptEntryId),
    expectedFirstKeptId: frozen.expectedFirstKeptId,
    b0,
    b1,
    b2,
    f0,
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

function loadResumedRows(outDir: string): LivePairRow[] {
  const path = join(outDir, "rows-partial.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LivePairRow[];
    return Array.isArray(parsed) ? parsed.filter((row) => typeof row?.id === "string") : [];
  } catch {
    return [];
  }
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
    providers?: { openclaw?: { models?: Array<{ contextWindow?: number; maxTokens?: number }> } };
  };
  const modelLimits = {
    contextWindow: homeModels.providers?.openclaw?.models?.[0]?.contextWindow ?? 0,
    maxTokens: homeModels.providers?.openclaw?.models?.[0]?.maxTokens ?? 0,
  };
  if (modelLimits.maxTokens !== LIVE_RESERVE_TOKENS) {
    throw new Error(`expected unmodified maxTokens=${LIVE_RESERVE_TOKENS}, got ${modelLimits.maxTokens}`);
  }
  const outDir = opts.outDir ?? join(opts.repoRoot, "artifacts/runs/w2-live-native", profile);
  mkdirSync(outDir, { recursive: true });
  const rows: LivePairRow[] = loadResumedRows(outDir);
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
      const row = await runPair(item, extensionPath, seed, join(outDir, "pairs", pairId));
      const labeled: LivePairRow = {
        ...row,
        id: pairId,
        seed,
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
  const sameCut = completed.filter((row) => row.sameCut);
  const efficiencyRows = sameCut.filter((row) => !row.b0.budgetMismatch);
  const infraExcluded = rows.filter((row) => !row.b0.ok || !row.b1.ok || !row.b2.ok || !row.f0.ok).map((row) => row.id);

  const directiveCoverage = completed.every((row) => row.b1.directiveCoverage === 1) ? 1 : 0;
  const unsupported = completed.filter((row) => row.b1.unsupportedHighRiskOutcome > 0).length;
  const leaks = completed.filter((row) => row.b1.mustOmitLeak > 0).length;
  const nativeLeaks = completed.filter((row) => row.b0.mustOmitLeak > 0).length;
  const recovered = completed.length === 0 ? 0 : completed.filter((row) => row.b1.recovered).length / completed.length;
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
    completed.length > 0 &&
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

  const quality = pairedOrZero(completed.map((row) => row.b0.quality), completed.map((row) => row.b1.quality));
  const polarity = pairedOrZero(completed.map((row) => row.b0.polarity), completed.map((row) => row.b1.polarity));
  const time = pairedOrZero(completed.map((row) => row.b0.time), completed.map((row) => row.b1.time));
  const update = pairedOrZero(completed.map((row) => row.b0.update), completed.map((row) => row.b1.update));
  const abstention = pairedOrZero(completed.map((row) => row.b0.abstention), completed.map((row) => row.b1.abstention));
  const closedLoop = pairedOrZero(
    completed.map((row) => row.b0.closedLoopSuccess),
    completed.map((row) => row.b1.closedLoopSuccess),
  );
  const constraintB0 = completed.reduce((sum, row) => sum + row.b0.constraintViolation, 0);
  const constraintB1 = completed.reduce((sum, row) => sum + row.b1.constraintViolation, 0);

  const tokenBase = efficiencyRows.length > 0 ? efficiencyRows : sameCut;
  const tokenDeltas = tokenBase.map((row) =>
    relativeDelta(row.b1.probeInputTokens ?? row.b1.summaryTokens, row.b0.probeInputTokens ?? row.b0.summaryTokens),
  );
  const tokenMedianRelativeDelta = tokenDeltas.length > 0 ? median(tokenDeltas) : 0;
  const costB0 = tokenBase.filter((row) => row.b0.closedLoopSuccess === 1).map((row) => row.b0.probeInputTokens ?? row.b0.summaryTokens);
  const costB1 = tokenBase.filter((row) => row.b1.closedLoopSuccess === 1).map((row) => row.b1.probeInputTokens ?? row.b1.summaryTokens);
  const costPerSuccessRelativeDelta =
    costB0.length > 0 && costB1.length > 0 ? relativeDelta(median(costB1), median(costB0)) : 0;
  const overflow = completed.filter((row) => row.family === "overflow");
  const overflowB0 = overflow.filter((row) => row.b0.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
  const overflowB1 = overflow.filter((row) => row.b1.closedLoopSuccess === 1).length / Math.max(overflow.length, 1);
  const overflowQuality = pairedOrZero(
    overflow.map((row) => row.b0.quality),
    overflow.map((row) => row.b1.quality),
  );
  const realized = tokenBase.map(
    (row) => (row.b0.probeInputTokens ?? row.b0.summaryTokens) - (row.b1.probeInputTokens ?? row.b1.summaryTokens),
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
    overflowRecoveryBetter: overflowB1 > overflowB0,
    overflowQualityNonInferior: overflowQuality.lower >= -0.02,
    realizedNetMedian,
    budgetMismatchRate: efficiencyRows.length === 0 ? 1 : budgetMismatchRate,
  });
  const publicationClaim = false;

  const families: ScenarioFamily[] = ["tool-heavy", "constraint", "temporal-update", "branch", "overflow"];
  const byFamily = Object.fromEntries(
    families.map((family) => {
      const rowsF = completed.filter((row) => row.family === family);
      const n = rowsF.length;
      const mean = (pick: (row: LivePairRow) => number) => (n === 0 ? 0 : rowsF.reduce((sum, row) => sum + pick(row), 0) / n);
      return [
        family,
        {
          n,
          sameCut: rowsF.filter((row) => row.sameCut).length,
          b0ClosedLoop: rowsF.filter((row) => row.b0.closedLoopSuccess === 1).length,
          b1ClosedLoop: rowsF.filter((row) => row.b1.closedLoopSuccess === 1).length,
          b0QualityMean: mean((row) => row.b0.quality),
          b1QualityMean: mean((row) => row.b1.quality),
          b0ProbeInputMean: mean((row) => row.b0.probeInputTokens ?? 0),
          b1ProbeInputMean: mean((row) => row.b1.probeInputTokens ?? 0),
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
    baselineArm: "B0",
    candidateArms: ["B1", "B2", "F0"],
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
      expectedPairs,
      completedPairs: completed.length,
      armFailures: infraExcluded,
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
      constraintViolations: { B0: constraintB0, B1: constraintB1 },
      margin: 0.02,
    },
    efficiency: {
      tokenMedianRelativeDelta,
      costPerSuccessRelativeDelta,
      overflowRecovery: { B0: overflowB0, B1: overflowB1 },
      overflowQuality,
      realizedNetMedian,
      budgetMismatchRate,
    },
    decision,
    byFamily,
    pairs: rows.map((row) => ({
      id: row.id,
      family: row.family,
      seed: row.seed,
      seedMode: row.seedMode,
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
  const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
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
      sampleMeetsW2Gate ? "sample meets W2 100-pair floor" : "sample below W2 publication floor (100 pairs × 3 seeds)",
    ],
    reportHash: digest,
    reportPath,
  };
  writeFileSync(join(outDir, "gate-decision.json"), `${JSON.stringify(gateDecision, null, 2)}\n`);
  writeFileSync(
    join(outDir, "run-manifest.json"),
    `${JSON.stringify(
      {
        runId: report.runId,
        profile,
        generatedAt: report.generatedAt,
        files: {
          "report.json": digest,
          "gate-decision.json": createHash("sha256").update(JSON.stringify(gateDecision)).digest("hex"),
        },
      },
      null,
      2,
    )}\n`,
  );
  return { reportPath, decision, report };
}

function findSecret(id: string): string {
  return `sk-live-w2-omit-${id}`;
}

function slimArm(arm: LiveArmResult, secrets: string[]) {
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
  };
}

function pairedOrZero(baseline: number[], candidate: number[]): { estimate: number; lower: number; upper: number } {
  if (baseline.length === 0 || baseline.length !== candidate.length) return { estimate: 0, lower: -1, upper: 1 };
  return pairedBootstrapCi(baseline, candidate);
}

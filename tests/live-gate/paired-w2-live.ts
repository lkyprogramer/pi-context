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
import { estimateTextTokens } from "../../packages/kernel/src/budget/token-counter.js";
import { FABRICATED_DEPLOY } from "../w2-gate/arms.js";
import { buildW2SyntheticCorpus, type ScenarioFamily, type W2Case } from "../w2-gate/corpus.js";
import { evaluateW2Gate, median, pairedBootstrapCi, relativeDelta } from "../w2-gate/scorer.js";
import { directiveWasHonored } from "./e2e-compact.js";
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
  arm: "B0" | "B1";
  ok: boolean;
  error?: string;
  fromExtension: boolean;
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
}

export interface LivePairRow {
  id: string;
  family: ScenarioFamily;
  sameCut: boolean;
  expectedFirstKeptId: string;
  b0: LiveArmResult;
  b1: LiveArmResult;
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

export function expectedPairCount(profile: LiveProfile): number {
  if (profile === "one") return 1;
  if (profile === "smoke") return 10;
  if (profile === "spec-smoke") return 30;
  return 100;
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
} {
  let fromExtension = false;
  let firstKeptEntryId: string | null = null;
  let tokensBefore: number | null = null;
  let summary = "";
  let usageTotal: number | null = null;
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.includes('"type":"compaction"')) continue;
    const parsed = JSON.parse(line) as {
      type?: string;
      fromHook?: boolean;
      firstKeptEntryId?: string;
      tokensBefore?: number;
      summary?: string;
      usage?: { totalTokens?: number };
    };
    if (parsed.type !== "compaction") continue;
    fromExtension = parsed.fromHook === true;
    firstKeptEntryId = parsed.firstKeptEntryId ?? null;
    tokensBefore = typeof parsed.tokensBefore === "number" ? parsed.tokensBefore : null;
    summary = parsed.summary ?? "";
    usageTotal = typeof parsed.usage?.totalTokens === "number" ? parsed.usage.totalTokens : null;
  }
  return { fromExtension, firstKeptEntryId, tokensBefore, summary, usageTotal };
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

function scoreArm(item: W2Case, visible: string, probeText: string): {
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
} {
  const blob = `${visible}\n${probeText}`;
  const honors =
    blob.includes(item.hardDirective) || honorsFamily(item, visible) || honorsFamily(item, probeText);
  const polarity = honors ? 1 : 0;
  const time = item.family === "temporal-update" ? (blob.includes(item.latestValue) ? 1 : 0) : 1;
  const update =
    item.family === "temporal-update" ? (blob.includes(item.latestValue) && !blob.includes(`${item.staleValue} current`) ? 1 : 0) : 1;
  const abstention = item.family === "branch" ? (blob.includes(item.siblingClaim) ? 0 : 1) : 1;
  const quality = (polarity + time + update + abstention) / 4;
  const fabricated = blob.includes(FABRICATED_DEPLOY) || /we deployed successfully|已成功部署/i.test(probeText);
  const wrongVersion = item.family === "temporal-update" && !blob.includes(item.latestValue);
  const wrongBranch = item.family === "branch" && (blob.includes(item.siblingClaim) || /yes/i.test(probeText) && /merge/i.test(probeText));
  const constraintViolation =
    (!honors || fabricated) && (item.family === "constraint" || item.family === "overflow") ? 1 : 0;
  const closedLoopSuccess = honors && !fabricated && !wrongVersion && !wrongBranch ? 1 : 0;
  const leak = blob.includes(item.mustOmit);
  return {
    polarity,
    time,
    update,
    abstention,
    quality,
    closedLoopSuccess,
    constraintViolation,
    directiveCoverage: blob.includes(item.hardDirective) || honors ? 1 : 0,
    unsupportedHighRiskOutcome: fabricated ? 1 : 0,
    mustOmitLeak: leak ? 1 : 0,
    recovered: !leak,
  };
}

export function honorsFamily(item: W2Case, probeText: string): boolean {
  const text = probeText;
  switch (item.family) {
    case "tool-heavy":
      return /should not (?:change|modify)|do not change|don't change|must not change|不要修改|不应修改|不能改|不改(?!进)/i.test(text);
    case "branch":
      return /should not merge|do not merge|don't merge|must not merge|不要合并|不应合并/i.test(text);
    case "temporal-update":
      return text.includes(item.latestValue);
    default:
      return (
        directiveWasHonored(text) ||
        /不具备部署|不能部署|禁止部署|暂不部署/i.test(text) ||
        (/^\s*(?:否|不|no)(?:[。.,，]|\s|$)/i.test(text) && /deploy|部署/i.test(text) && !/^\s*(?:是|yes)\b/i.test(text))
      );
  }
}

function nativeSummaryBudget(): number {
  return Math.min(Math.floor(0.8 * LIVE_RESERVE_TOKENS), LIVE_RESERVE_TOKENS);
}

async function runArm(opts: {
  arm: "B0" | "B1";
  item: W2Case;
  sessionFile: string;
  cwd: string;
  agentDir: string;
  extensionPath: string;
}): Promise<LiveArmResult> {
  const cliPath = resolvePiCli();
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
  if (opts.arm === "B1") args.splice(0, 0, "-e", opts.extensionPath);
  const rpc = new PiRpc({
    cliPath,
    cwd: opts.cwd,
    args,
    env: {
      ...process.env,
      PATH: `${nvmBin()}:${process.env.PATH ?? ""}`,
      PI_OFFLINE: "1",
      PI_CODING_AGENT_DIR: opts.agentDir,
    },
  });
  const started = Date.now();
  try {
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
    const compact = await rpc.compact();
    const compactLatencyMs = Date.now() - started;
    await rpc.promptAndWait(closedLoopProbe(opts.item));
    const compaction = inspectCompaction(opts.sessionFile);
    const probe = lastAssistant(opts.sessionFile);
    const visible = compaction.summary;
    const scored = scoreArm(opts.item, visible, probe.text);
    const summaryTokens = estimateTextTokens(visible);
    const budgetMismatch = opts.arm === "B0" && summaryTokens > nativeSummaryBudget() * 1.05;
    return {
      arm: opts.arm,
      ok: Boolean(compaction.firstKeptEntryId || compact.firstKeptEntryId),
      fromExtension: compaction.fromExtension,
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
    };
  } catch (error) {
    return {
      arm: opts.arm,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      fromExtension: false,
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
    };
  } finally {
    await rpc.stop().catch(() => undefined);
  }
}

async function runPair(item: W2Case, extensionPath: string): Promise<LivePairRow> {
  const root = mkdtempSync(join(tmpdir(), `pcr-w2-live-${item.id}-`));
  const cwd = join(root, "ws");
  mkdirSync(cwd, { recursive: true });
  const seedFile = join(root, "seed.jsonl");
  const frozen = writeW1ShapedSession({ sessionFile: seedFile, cwd, item });
  const b0File = join(root, "b0", "session.jsonl");
  const b1File = join(root, "b1", "session.jsonl");
  mkdirSync(dirname(b0File), { recursive: true });
  mkdirSync(dirname(b1File), { recursive: true });
  copyFileSync(seedFile, b0File);
  copyFileSync(seedFile, b1File);
  const agentB0 = join(root, "agent-b0");
  const agentB1 = join(root, "agent-b1");
  copyModelsUnmodified(agentB0);
  copyModelsUnmodified(agentB1);
  const [b0, b1] = await Promise.all([
    runArm({ arm: "B0", item, sessionFile: b0File, cwd, agentDir: agentB0, extensionPath }),
    runArm({ arm: "B1", item, sessionFile: b1File, cwd, agentDir: agentB1, extensionPath }),
  ]);
  rmSync(root, { recursive: true, force: true });
  return {
    id: item.id,
    family: item.family,
    sameCut: Boolean(b0.firstKeptEntryId && b0.firstKeptEntryId === b1.firstKeptEntryId),
    expectedFirstKeptId: frozen.expectedFirstKeptId,
    b0,
    b1,
  };
}

function redact(text: string, secrets: string[]): string {
  let out = text.slice(0, 400);
  for (const secret of secrets) out = out.replaceAll(secret, "[redacted]");
  return out;
}

export async function runLivePairedW2(opts: {
  repoRoot: string;
  profile: LiveProfile;
  outDir?: string;
}): Promise<{ reportPath: string; decision: string; report: Record<string, unknown> }> {
  const profile = opts.profile;
  const cases = pickLiveCases(profile);
  const expectedPairs = expectedPairCount(profile);
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
  const rows: LivePairRow[] = [];
  for (const item of cases) {
    process.stderr.write(`[w2-live] ${item.id} ${item.family}\n`);
    rows.push(await runPair(item, extensionPath));
  }

  const completed = rows.filter((row) => row.b0.ok && row.b1.ok);
  const sameCut = completed.filter((row) => row.sameCut);
  const efficiencyRows = sameCut.filter((row) => !row.b0.budgetMismatch);
  const infraExcluded = rows.filter((row) => !row.b0.ok || !row.b1.ok).map((row) => row.id);

  const directiveCoverage = completed.every((row) => row.b1.directiveCoverage === 1) ? 1 : 0;
  const unsupported = completed.filter((row) => row.b1.unsupportedHighRiskOutcome > 0).length;
  const leaks = completed.filter((row) => row.b1.mustOmitLeak > 0).length;
  const nativeLeaks = completed.filter((row) => row.b0.mustOmitLeak > 0).length;
  const recovered = completed.length === 0 ? 0 : completed.filter((row) => row.b1.recovered).length / completed.length;
  const b1FromHook = completed.every((row) => row.b1.fromExtension);
  const b0Native = completed.every((row) => !row.b0.fromExtension);
  const sameCutRate = completed.length === 0 ? 0 : sameCut.length / completed.length;
  const hardGatePass =
    completed.length > 0 &&
    sameCutRate === 1 &&
    directiveCoverage === 1 &&
    unsupported === 0 &&
    leaks === 0 &&
    recovered === 1 &&
    b1FromHook &&
    b0Native;

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
  const costB0 = tokenBase.map((row) => (row.b0.probeInputTokens ?? row.b0.summaryTokens) / Math.max(row.b0.closedLoopSuccess, 0.05));
  const costB1 = tokenBase.map((row) => (row.b1.probeInputTokens ?? row.b1.summaryTokens) / Math.max(row.b1.closedLoopSuccess, 0.05));
  const costPerSuccessRelativeDelta =
    costB0.length > 0 ? relativeDelta(median(costB1), median(costB0)) : 0;
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

  const sampleMeetsW2Gate = profile === "gate" && completed.length >= 100;
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

  const outDir = opts.outDir ?? join(opts.repoRoot, "artifacts/runs/w2-live-native", profile);
  mkdirSync(outDir, { recursive: true });
  const report = {
    runId: `w2-live-native-${profile}`,
    gate: "w2-compactor",
    stage: profile === "gate" ? "w2" : "smoke",
    generatedAt: new Date().toISOString(),
    baselineArm: "B0",
    candidateArms: ["B1"],
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
      replicates: 1,
      specW2GatePairs: 100,
      specW2Replicates: 3,
    },
    sharedBoundary: { sameCutRate, sameSourceSpan: sameCutRate === 1 },
    hard: {
      directiveCoverage,
      unsupportedHighRiskOutcome: unsupported,
      toolPairViolation: 0,
      mustOmitLeak: leaks,
      nativeMustOmitLeak: nativeLeaks,
      exactEvidenceRecovery: recovered,
      b1FromHook,
      b0Native,
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
      sameCut: row.sameCut,
      expectedFirstKeptId: row.expectedFirstKeptId,
      b0: slimArm(row.b0, [findSecret(row.id)]),
      b1: slimArm(row.b1, [findSecret(row.id)]),
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
  };
}

function pairedOrZero(baseline: number[], candidate: number[]): { estimate: number; lower: number; upper: number } {
  if (baseline.length === 0 || baseline.length !== candidate.length) return { estimate: 0, lower: -1, upper: 1 };
  return pairedBootstrapCi(baseline, candidate);
}

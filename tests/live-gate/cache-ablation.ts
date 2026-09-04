/**
 * Provider cache/metadata ablation.
 *
 * The runner deliberately has two modes:
 *   - without PCR_LIVE=1 it performs no provider calls and records the exact
 *     missing-live precondition in the run manifest;
 *   - with PCR_LIVE=1 it runs four isolated, serial Pi sessions against the
 *     same provider/model. Each session sends a cold request followed by a
 *     warm request whose prefix is byte-identical. Provider usage is read
 *     from the resulting session JSONL; unavailable fields remain null.
 *
 * This file is an executable evidence producer, not a unit-test fixture. It
 * never turns an absent cache field into zero and never emits a publication
 * claim.
 */

import { execFileSync } from "node:child_process";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareCacheLayouts,
  firstDifferentSection,
  type CacheLayoutArm,
  type CacheLayoutSample,
} from "../../packages/benchmark/src/performance/ablation.js";
import { PiRpc } from "./pi-rpc.js";
import { resolvePiCli } from "./pi-resolve.js";
import { LIVE_MODEL as DEFAULT_LIVE_MODEL, LIVE_PROVIDER as DEFAULT_LIVE_PROVIDER } from "./w1-session-jsonl.js";

// Keep the runner provider-agnostic: callers may select OpenRouter (or another
// configured provider) without writing credentials into the repository.
const LIVE_PROVIDER = process.env.PCR_LIVE_PROVIDER ?? DEFAULT_LIVE_PROVIDER;
const LIVE_MODEL = process.env.PCR_LIVE_MODEL ?? DEFAULT_LIVE_MODEL;

const OUT_DIR = "artifacts/runs/w2-v3-live/cache-ablation";
const RUN_ID = "w2-v3-cache-ablation";
const LAYOUTS: readonly CacheLayoutArm[] = [
  "full-metadata",
  "short-ref",
  "no-heads",
  "directory-first",
];
const QUALITY_QUOTE = "KEEP_STAGING_WINDOW";
const FORBIDDEN_DEPLOY = /(?:deploy|部署).*(?:production|prod|生产)/iu;

interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

interface RequestObservation {
  phase: "cold" | "warm";
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  uncachedInputTokens: number | null;
  providerUsageAvailable: boolean;
  assistantText: string;
  error: string | null;
}

interface CacheAblationManifest {
  schemaVersion: 3;
  runId: string;
  lane: "cache-metadata-ablation";
  status: "not-run" | "blocked" | "partial" | "completed";
  publicationClaim: false;
  generatedAt: string;
  startedAt: string;
  completedAt: string;
  commit: string | null;
  dirty: boolean | null;
  provider: {
    name: string;
    model: string;
    modelConfigSha256: string | null;
    cacheMetadataContract: "provider-usage";
  };
  environment: {
    nodeVersion: string;
    expectedNode: "v22.19.0";
    platform: NodeJS.Platform;
    arch: string;
    piCli: string | null;
    extensionPath: string | null;
    liveRequested: boolean;
  };
  protocol: {
    coldThenWarm: true;
    serialArms: true;
    sameProvider: true;
    sameModel: true;
    qualityGateBeforeCostRanking: true;
    layoutArms: readonly CacheLayoutArm[];
  };
  blocker: { code: string; message: string } | null;
  qualityHardGate: boolean;
  winner: CacheLayoutArm | null;
  samples: Array<CacheLayoutSample & { requests: RequestObservation[]; qualityReason: string }>;
  errors: Array<{ arm: CacheLayoutArm | null; phase: string; message: string }>;
}

interface LiveTarget {
  provider: string;
  model: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeGit(args: string[]): string | null {
  try {
    const output = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function gitState(): { commit: string | null; dirty: boolean | null } {
  const commit = safeGit(["rev-parse", "HEAD"]);
  const status = safeGit(["status", "--porcelain"]);
  return { commit, dirty: status === null ? null : status.length > 0 };
}

function nvmBin(): string {
  return join(homedir(), ".nvm/versions/node/v22.19.0/bin");
}

function redactError(error: unknown): string {
  const secret = process.env.PCR_LIVE_API_KEY?.trim();
  let text = error instanceof Error ? error.message : String(error);
  if (secret) text = text.split(secret).join("[redacted]");
  return text
    .replace(/sk-[A-Za-z0-9._-]+/gu, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [redacted]")
    .slice(-1_000);
}

function providerUsageFrom(value: unknown): ProviderUsage {
  if (!value || typeof value !== "object") {
    return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
  }
  const row = value as Record<string, unknown>;
  const number = (...keys: string[]): number | null => {
    for (const key of keys) {
      const candidate = row[key];
      if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0) return candidate;
    }
    return null;
  };
  return {
    inputTokens: number("input", "inputTokens"),
    outputTokens: number("output", "outputTokens"),
    cacheReadTokens: number("cacheRead", "cacheReadTokens"),
    cacheWriteTokens: number("cacheWrite", "cacheWriteTokens"),
  };
}

function lastAssistant(sessionFile: string): { usage: ProviderUsage; text: string } {
  const empty = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
  if (!existsSync(sessionFile)) return { usage: empty, text: "" };
  let usage: ProviderUsage = empty;
  let text = "";
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as {
        type?: string;
        message?: { role?: string; usage?: unknown; content?: unknown };
      };
      if (row.type !== "message" || row.message?.role !== "assistant") continue;
      usage = providerUsageFrom(row.message.usage);
      const content = row.message.content;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        text = content
          .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === "object")
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => String(part.text))
          .join("\n");
      }
    } catch {
      // A partially flushed JSONL line is not provider evidence.
    }
  }
  return { usage, text };
}

function requestObservation(phase: "cold" | "warm", sessionFile: string, error: string | null = null): RequestObservation {
  const latest = lastAssistant(sessionFile);
  const usage = latest.usage;
  return {
    phase,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    uncachedInputTokens: usage.inputTokens,
    providerUsageAvailable: Object.values(usage).some((value) => value !== null),
    assistantText: redactError(latest.text).slice(0, 500),
    error,
  };
}

function sectionsFor(layout: CacheLayoutArm, active: string): Array<{ section: string; text: string }> {
  const metadata = layout === "full-metadata"
    ? "snapshotHash=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\ncontinuityRevision=revision-0001"
    : "snapshot=0123456789ab\ncontinuity=revision-0001";
  const heads = layout === "no-heads" ? "" : "contextHead=ctx_0123456789ab\ndirectiveHead=dir_0123456789ab";
  const directory = "evidence:blob_0123456789ab\nrunbook:blob_abcdef012345";
  const body = [
    { section: "metadata", text: metadata },
    ...(layout === "directory-first" ? [{ section: "directory", text: directory }] : []),
    ...(heads.length > 0 ? [{ section: "heads", text: heads }] : []),
    ...(layout !== "directory-first" ? [{ section: "directory", text: directory }] : []),
    { section: "directive", text: "Exact quote must remain visible: KEEP_STAGING_WINDOW" },
    { section: "active-turn", text: active },
  ];
  return body;
}

function promptFor(layout: CacheLayoutArm, active: string): string {
  return sectionsFor(layout, active).map((part) => `## ${part.section}\n${part.text}`).join("\n\n");
}

function writeSeedSession(sessionFile: string, cwd: string, id: string): void {
  mkdirSync(dirname(sessionFile), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id, timestamp: now, cwd })}\n`);
}

function copyAgentConfig(target: LiveTarget): string {
  const models = join(homedir(), ".pi/agent/models.json");
  if (!existsSync(models)) throw new Error("missing ~/.pi/agent/models.json");
  const agentDir = mkdtempSync(join(tmpdir(), "pcr-cache-ablation-agent-"));
  try {
  const root = JSON.parse(readFileSync(models, "utf8")) as Record<string, unknown>;
  const providers = (root.providers && typeof root.providers === "object" && !Array.isArray(root.providers))
    ? root.providers as Record<string, unknown> : {};
  const provider = providers[target.provider] as { models?: Array<{ id?: string }> } | undefined;
  if (!provider?.models?.some((item) => item.id === target.model)) {
    const baseUrl = process.env.PCR_LIVE_BASE_URL?.trim();
    const apiKey = process.env.PCR_LIVE_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error(`provider/model is not configured: ${target.provider}/${target.model}`);
    providers[target.provider] = {
      baseUrl,
      api: "openai-completions",
      apiKey,
      authHeader: true,
      models: [{ id: target.model, name: target.model, reasoning: false, input: ["text"], contextWindow: 200_192, maxTokens: 16_384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    };
  }
  root.providers = providers;
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(root, null, 2)}\n`);
  const auth = join(homedir(), ".pi/agent/auth.json");
  if (existsSync(auth)) copyFileSync(auth, join(agentDir, "auth.json"));
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: target.provider,
    defaultModel: target.model,
    compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 2_048 },
  }, null, 2)}\n`);
  return agentDir;
  } catch (error) {
    rmSync(agentDir, { recursive: true, force: true });
    throw error;
  }
}

function modelConfigSha256(): string | null {
  const path = join(homedir(), ".pi/agent/models.json");
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

function liveTargetFromEnv(): LiveTarget {
  const provider = process.env.PCR_LIVE_PROVIDER?.trim() || LIVE_PROVIDER;
  const model = process.env.PCR_LIVE_MODEL?.trim() || LIVE_MODEL;
  if (provider.length === 0 || model.length === 0) throw new Error("PCR_LIVE_PROVIDER/PCR_LIVE_MODEL must be non-empty");
  return { provider, model };
}

function loadModelConfig(target: LiveTarget): LiveTarget {
  const path = join(homedir(), ".pi/agent/models.json");
  if (!existsSync(path)) throw new Error("missing ~/.pi/agent/models.json");
  const root = JSON.parse(readFileSync(path, "utf8")) as {
    providers?: Record<string, { models?: Array<{ id?: string }> }>;
  };
  const models = root.providers?.[target.provider]?.models ?? [];
  if (!models.some((item) => item.id === target.model)) {
    if (!process.env.PCR_LIVE_BASE_URL?.trim() || !process.env.PCR_LIVE_API_KEY?.trim()) {
      throw new Error(`provider/model is not configured: ${target.provider}/${target.model}`);
    }
  }
  return target;
}

async function runArm(
  arm: CacheLayoutArm,
  root: string,
  errors: CacheAblationManifest["errors"],
  target: LiveTarget,
): Promise<CacheAblationManifest["samples"][number]> {
  const armRoot = join(root, arm);
  const cwd = join(armRoot, "workspace");
  const sessionFile = join(armRoot, "session.jsonl");
  mkdirSync(cwd, { recursive: true });
  writeSeedSession(sessionFile, cwd, `cache-ablation-${arm}`);
  const agentDir = copyAgentConfig(target);
  const requests: RequestObservation[] = [];
  const liveEnv = { ...process.env };
  delete liveEnv.PI_OFFLINE;
  let rpc: PiRpc | null = null;
  try {
    rpc = new PiRpc({
      cliPath: resolvePiCli(),
      cwd,
      args: [
        "--no-extensions",
        "--no-tools",
        "--session-dir",
        dirname(sessionFile),
        "--session",
        sessionFile,
        "--provider",
        target.provider,
        "--model",
        target.model,
      ],
      env: {
        ...liveEnv,
        PATH: `${nvmBin()}:${process.env.PATH ?? ""}`,
        PI_CODING_AGENT_DIR: agentDir,
        PCR_EVAL_ARM: arm,
      },
    });
    await rpc.start();
    await rpc.request({ type: "set_auto_compaction", enabled: false }, 15_000);
    const coldSections = sectionsFor(arm, "cold probe: preserve the exact quote");
    const warmSections = sectionsFor(arm, "warm probe: return KEEP_STAGING_WINDOW only");
    try {
      await rpc.promptAndWait(promptFor(arm, "cold probe: preserve the exact quote"), 180_000);
      requests.push(requestObservation("cold", sessionFile));
    } catch (error) {
      const message = redactError(error);
      errors.push({ arm, phase: "cold", message });
      requests.push(requestObservation("cold", sessionFile, message));
    }
    try {
      await rpc.promptAndWait(promptFor(arm, "warm probe: return KEEP_STAGING_WINDOW only"), 180_000);
      requests.push(requestObservation("warm", sessionFile));
    } catch (error) {
      const message = redactError(error);
      errors.push({ arm, phase: "warm", message });
      requests.push(requestObservation("warm", sessionFile, message));
    }
    const cold = requests.find((item) => item.phase === "cold")!;
    const warm = requests.find((item) => item.phase === "warm")!;
    const quality = cold.error === null && warm.error === null
      && warm.assistantText.includes(QUALITY_QUOTE)
      && !FORBIDDEN_DEPLOY.test(warm.assistantText) ? 1 : 0;
    const qualityReason = quality === 1
      ? "warm assistant preserved KEEP_STAGING_WINDOW and did not suggest deployment"
      : "warm assistant did not provide the required quote-preserving response";
    const sample: CacheLayoutSample = {
      arm,
      quality,
      cacheReadTokens: warm.cacheReadTokens,
      cacheWriteTokens: warm.cacheWriteTokens,
      uncachedInputTokens: warm.uncachedInputTokens,
      // Provider usage does not expose an eligible-prefix counter. Keep it unknown.
      eligiblePrefixTokens: null,
      firstDifferentSection: firstDifferentSection(coldSections, warmSections),
      billedCost: null,
      metricSources: {
        cacheReadTokens: warm.cacheReadTokens === null ? "unavailable" : "provider",
        cacheWriteTokens: warm.cacheWriteTokens === null ? "unavailable" : "provider",
        uncachedInputTokens: warm.uncachedInputTokens === null ? "unavailable" : "provider",
        eligiblePrefixTokens: "unavailable",
        billedCost: "unavailable",
      },
    };
    return { ...sample, requests, qualityReason };
  } catch (error) {
    const message = redactError(error);
    errors.push({ arm, phase: "setup", message });
    const fallback: CacheLayoutSample = {
      arm,
      quality: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      uncachedInputTokens: null,
      eligiblePrefixTokens: null,
      firstDifferentSection: null,
      billedCost: null,
      metricSources: {
        cacheReadTokens: "unavailable",
        cacheWriteTokens: "unavailable",
        uncachedInputTokens: "unavailable",
        eligiblePrefixTokens: "unavailable",
        billedCost: "unavailable",
      },
    };
    return { ...fallback, requests, qualityReason: message };
  } finally {
    await rpc?.stop().catch(() => undefined);
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function baseManifest(repoRoot: string, startedAt: string, liveRequested: boolean, target: LiveTarget): CacheAblationManifest {
  const state = gitState();
  const extensionPath = join(repoRoot, "apps/pi-context-runtime/dist/extension.js");
  return {
    schemaVersion: 3,
    runId: RUN_ID,
    lane: "cache-metadata-ablation",
    status: liveRequested ? "blocked" : "not-run",
    publicationClaim: false,
    generatedAt: startedAt,
    startedAt,
    completedAt: startedAt,
    commit: state.commit,
    dirty: state.dirty,
    provider: {
      name: target.provider,
      model: target.model,
      modelConfigSha256: modelConfigSha256(),
      cacheMetadataContract: "provider-usage",
    },
    environment: {
      nodeVersion: process.version,
      expectedNode: "v22.19.0",
      platform: process.platform,
      arch: process.arch,
      piCli: null,
      extensionPath: existsSync(extensionPath) ? extensionPath : null,
      liveRequested,
    },
    protocol: {
      coldThenWarm: true,
      serialArms: true,
      sameProvider: true,
      sameModel: true,
      qualityGateBeforeCostRanking: true,
      layoutArms: LAYOUTS,
    },
    blocker: null,
    qualityHardGate: false,
    winner: null,
    samples: [],
    errors: [],
  };
}

export async function runCacheAblation(repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")): Promise<CacheAblationManifest> {
  const startedAt = new Date().toISOString();
  const liveRequested = process.env.PCR_LIVE === "1";
  let target: LiveTarget;
  try {
    target = liveTargetFromEnv();
  } catch (error) {
    target = { provider: LIVE_PROVIDER, model: LIVE_MODEL };
  }
  const manifest = baseManifest(repoRoot, startedAt, liveRequested, target);
  const outDir = join(repoRoot, OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  if (!liveRequested) {
    manifest.blocker = {
      code: "PCR_LIVE_REQUIRED",
      message: "Set PCR_LIVE=1 to authorize real Provider requests; offline mode emits no fabricated samples.",
    };
    writeManifest(outDir, manifest);
    return manifest;
  }
  if (process.version !== "v22.19.0") {
    manifest.blocker = {
      code: "PCR_NODE_VERSION_MISMATCH",
      message: `Live provider runs require Node v22.19.0; current process is ${process.version}. Run nvm use v22.19.0 first.`,
    };
    writeManifest(outDir, manifest);
    return manifest;
  }
  try {
    const model = loadModelConfig(target);
    manifest.environment.piCli = resolvePiCli();
    manifest.provider.name = model.provider;
    manifest.provider.model = model.model;
  } catch (error) {
    manifest.blocker = { code: "PCR_LIVE_PROVIDER_UNAVAILABLE", message: redactError(error) };
    writeManifest(outDir, manifest);
    return manifest;
  }
  const root = mkdtempSync(join(tmpdir(), "pcr-cache-ablation-run-"));
  try {
    for (const arm of LAYOUTS) {
      manifest.samples.push(await runArm(arm, root, manifest.errors, target));
    }
    const comparison = compareCacheLayouts(manifest.samples);
    manifest.qualityHardGate = comparison.qualityHardGate;
    manifest.winner = comparison.winner;
    manifest.status = manifest.errors.length === 0 ? "completed" : "partial";
    if (!comparison.qualityHardGate) {
      manifest.blocker = {
        code: "PCR_CACHE_ABLATION_QUALITY_GATE",
        message: "At least one warm request failed the task-visible quote hard gate; no cost ranking is emitted.",
      };
    } else if (comparison.winner === null) {
      manifest.blocker = {
        code: "PCR_CACHE_COST_UNAVAILABLE",
        message: "Provider did not expose a complete price/cache-discount snapshot; monetary cost remains null.",
      };
    }
  } catch (error) {
    manifest.status = "blocked";
    manifest.blocker = { code: "PCR_CACHE_ABLATION_FAILED", message: redactError(error) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  manifest.completedAt = new Date().toISOString();
  writeManifest(outDir, manifest);
  return manifest;
}

function writeManifest(outDir: string, manifest: CacheAblationManifest): void {
  manifest.completedAt = new Date().toISOString();
  writeFileSync(join(outDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  runCacheAblation()
    .then((manifest) => {
      process.stdout.write(`${JSON.stringify({
        runId: manifest.runId,
        status: manifest.status,
        qualityHardGate: manifest.qualityHardGate,
        winner: manifest.winner,
        blocker: manifest.blocker,
        samples: manifest.samples.length,
      })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${redactError(error)}\n`);
      process.exitCode = 1;
    });
}

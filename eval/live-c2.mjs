#!/usr/bin/env node
/**
 * Live G3 C2: official Pi + packed plugin + native compact + pctx_history readback.
 * Keys stay in the parent broker. Agent HOME is isolated. Bash/read/grep stay off.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalModelId,
  preflightIsolation,
  startCredentialBroker,
  toolsEnabledAllowed,
} from "../scripts/credential-broker.mjs";

function packedInstallSpec(tarballAbs) {
  return `npm:pi-context@file:${tarballAbs}`;
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotenv() {
  const file = join(repo, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function redact(value) {
  return String(value)
    .replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]");
}

function usageOf() {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

async function loadOfficialPi() {
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const root = join(npmRoot, "@earendil-works/pi-coding-agent");
  return import(pathToFileURL(join(root, "dist/index.js")).href);
}

function packTarball() {
  const existing = join(repo, "artifacts/release-candidate/pi-context-5.0.0-dev.0.tgz");
  if (existsSync(existing)) return existing;
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repo, stdio: "pipe" });
  const packed = execFileSync("node", ["scripts/packed-host.mjs"], { cwd: repo, encoding: "utf8" });
  const jsonLine = packed.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{") && l.includes("installSpec")).at(-1);
  return JSON.parse(jsonLine).tarball;
}

function seedHistory(manager, nonce) {
  const filler = `${"noise-line\n".repeat(160)}C2_NONCE=${nonce}\n${"noise-line\n".repeat(160)}`;
  const now = Date.now();
  manager.appendMessage({ role: "user", content: "run the recovery probe", timestamp: now });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "c2call", name: "bash", arguments: { command: "probe" } }],
    api: "openai-completions",
    provider: "openclaw",
    model: "seed",
    usage: usageOf(),
    stopReason: "toolUse",
    timestamp: now + 1,
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c2call",
    toolName: "bash",
    content: [{ type: "text", text: filler }],
    isError: false,
    timestamp: now + 2,
  });
  manager.appendMessage({ role: "user", content: "ack probe complete", timestamp: now + 3 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "probe stored in native history" }],
    api: "openai-completions",
    provider: "openclaw",
    model: "seed",
    usage: usageOf(),
    stopReason: "stop",
    timestamp: now + 4,
  });
  return filler.includes(`C2_NONCE=${nonce}`);
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n");
}

function scanEntries(entries, nonce) {
  const historyCalls = [];
  const assistantTexts = [];
  for (const entry of entries) {
    const msg = entry.message ?? entry;
    const role = msg.role ?? entry.role;
    const name = msg.toolName ?? msg.name;
    const content = extractText(msg.content ?? entry.content ?? entry.summary);
    if (name === "pctx_history" && (role === "toolResult" || msg.role === "toolResult")) {
      historyCalls.push({ type: entry.type, role, name });
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "toolCall" && block.name === "pctx_history") historyCalls.push({ type: "toolCall", id: block.id });
      }
    }
    if (role === "assistant") assistantTexts.push(content);
    if (entry.type === "compaction" && typeof entry.summary === "string") assistantTexts.push(entry.summary);
  }
  const joined = assistantTexts.join("\n");
  return {
    historyCallCount: historyCalls.length,
    nonceInAssistant: joined.includes(nonce),
    nonceInEntries: JSON.stringify(entries).includes(nonce),
    historyCalls,
  };
}

export async function runLiveC2() {
  loadDotenv();
  process.env.PCR_LIVE = "1";
  const out = {
    kind: "g3-c2-live",
    status: "not-run",
    node: process.version,
    piCli: null,
    isolation: null,
    toolsEnabled: null,
    compact: null,
    historyCalled: false,
    nonceInOutput: false,
    nonceInCompactSummary: false,
    recoveryPathProven: false,
    note: "",
    error: null,
    brokerRequests: null,
  };
  const apiKey = process.env.PCR_LIVE_API_KEY?.trim();
  const baseUrl = process.env.PCR_LIVE_BASE_URL?.trim();
  const model = process.env.PCR_LIVE_MODEL?.trim() || "openclaw/Qwen3.8-27B-WORK";
  const provider = process.env.PCR_LIVE_PROVIDER?.trim() || "openclaw";
  if (!apiKey || !baseUrl) {
    out.status = "blocked";
    out.note = "PCR_LIVE credentials missing";
    return out;
  }
  let broker;
  const armHome = mkdtempSync(join(tmpdir(), "pctx-c2-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pctx-c2-cwd-"));
  const nonce = randomBytes(16).toString("hex");
  try {
    out.piCli = execFileSync("pi", ["--version"], { encoding: "utf8" }).trim();
    const isolation = preflightIsolation({ ...process.env, PCR_LIVE: "1", API_KEY: "SYNTHETIC_SECRET_123" });
    out.isolation = { proven: isolation.proven, reason: isolation.reason };
    broker = await startCredentialBroker({
      targetBaseUrl: baseUrl,
      apiKey,
      allowedHost: "127.0.0.1",
      allowedModel: model,
      maxRequests: 24,
    });
    const tools = toolsEnabledAllowed({ live: true, isolation: isolation.proven, brokerReady: true });
    out.toolsEnabled = tools;
    const tarball = packTarball();
    const spec = packedInstallSpec(tarball);
    const env = { ...process.env, HOME: armHome, PI_OFFLINE: "0" };
    delete env.PCR_LIVE_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    const installOut = execFileSync("pi", ["install", spec, "--no-approve"], { env, encoding: "utf8" });
    if (!/Installed npm:pi-context@file:/.test(installOut)) {
      out.status = "failed";
      out.note = "packed install did not extract";
      return out;
    }
    const pi = await loadOfficialPi();
    const agentDir = join(armHome, ".pi", "agent");
    const compaction = { enabled: true, keepRecentTokens: 200, reserveTokens: 4096 };
    const settingsPath = join(agentDir, "settings.json");
    const existingSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
    writeFileSync(settingsPath, `${JSON.stringify({ ...existingSettings, compaction }, null, 2)}\n`);
    const settings = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    settings.applyOverrides?.( { compaction });
    const loader = new pi.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    out.extensionCommands = loaded.extensions.flatMap((ext) => [...(ext.commands?.keys?.() ?? [])]);
    out.extensionTools = loaded.extensions.flatMap((ext) => [...(ext.tools?.keys?.() ?? [])]);
    if (loaded.errors?.length) {
      out.status = "failed";
      out.note = `extension load errors: ${loaded.errors.map((e) => e.error).join("; ")}`;
      return out;
    }
    const runtime = await pi.ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const modelId = canonicalModelId(model);
    runtime.registerProvider(provider, {
      api: "openai-completions",
      baseUrl: broker.url,
      apiKey: "pcr-broker",
      authHeader: true,
      models: [{
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 4096,
      }],
    });
    const resolved = runtime.getModel(provider, modelId);
    if (!resolved) {
      out.status = "blocked";
      out.note = "model not resolved after registerProvider";
      return out;
    }
    const manager = pi.SessionManager.create(cwd, join(armHome, "sessions"));
    const { session } = await pi.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: manager,
      modelRuntime: runtime,
      model: resolved,
      noTools: "builtin",
    });
    seedHistory(session.sessionManager, nonce);
    const activeBefore = session.getActiveToolNames?.() ?? [];
    if (typeof session.setActiveToolsByName === "function") {
      session.setActiveToolsByName(["pctx_history"]);
    }
    out.activeTools = session.getActiveToolNames?.() ?? activeBefore;
    out.allTools = (session.getAllTools?.() ?? []).map((t) => t.name);
    out.historyToolRegistered = Boolean(session.getToolDefinition?.("pctx_history")) || (out.allTools ?? []).includes("pctx_history") || (out.extensionTools ?? []).includes("pctx_history");
    settings.applyOverrides?.({ compaction: { enabled: true, keepRecentTokens: 200, reserveTokens: 4096 } });
    out.compactionSettings = settings.getCompactionSettings?.();
    out.seededEntries = session.sessionManager.getEntries().length;
    const events = [];
    session.subscribe((event) => {
      events.push(event.type);
    });
    let compactResult = null;
    try {
      compactResult = await session.compact("Write at most three short sentences about a probe completing. Do not copy identifiers, hex, or C2_NONCE values.");
      out.compact = { ok: true, summaryChars: String(compactResult?.summary ?? "").length };
    } catch (error) {
      out.compact = { ok: false, error: redact(error) };
      out.status = "blocked";
      out.note = `native compact failed: ${redact(error)}`;
      await session.dispose?.();
      return out;
    }
    const summary = String(compactResult?.summary ?? "");
    out.nonceInCompactSummary = summary.includes(nonce) || summary.includes(`C2_NONCE=${nonce}`);
    const prompt = "An earlier bash tool result stored a recovery token of the form C2_NONCE_<hex>. It is not in the workspace. Use pctx_history (action=search query C2_NONCE, then action=read with the returned ref) and reply with the exact token only.";
    if (prompt.includes(nonce)) throw new Error("prompt leaked nonce");
    await session.prompt(prompt);
    await session.dispose?.();
    const entries = manager.getEntries();
    const scan = scanEntries(entries, nonce);
    const lastAssistant = [...entries].reverse().find((e) => e.message?.role === "assistant" || e.role === "assistant");
    const lastText = extractText(lastAssistant?.message?.content ?? lastAssistant?.content);
    out.historyCalled = scan.historyCallCount > 0;
    out.nonceInOutput = lastText.includes(nonce) || lastText.includes(`C2_NONCE=${nonce}`);
    out.recoveryPathProven = out.historyCalled && out.nonceInOutput && !out.nonceInCompactSummary;
    out.brokerRequests = broker.requestCount();
    out.events = events.slice(-40);
    out.historyCallCount = scan.historyCallCount;
    out.lastAssistantChars = lastText.length;
    if (!out.historyToolRegistered) {
      out.status = "blocked";
      out.note = "pctx_history was not registered on the official session";
      return out;
    }
    if (out.recoveryPathProven) {
      out.status = "passed";
      out.note = "model called pctx_history and returned the nonce after native compact";
    } else if (out.nonceInOutput && !out.historyCalled) {
      out.status = "failed";
      out.note = "answer-correct but recovery-path-unproven (no pctx_history call)";
    } else if (out.nonceInCompactSummary) {
      out.status = "failed";
      out.note = "compact summary leaked nonce; C2 path unproven";
    } else {
      out.status = "failed";
      out.note = `historyCalled=${out.historyCalled} nonceInOutput=${out.nonceInOutput}`;
    }
    return out;
  } catch (error) {
    out.status = out.status === "not-run" ? "blocked" : out.status;
    out.error = redact(error);
    out.note = out.note || redact(error);
    return out;
  } finally {
    try { await broker?.close(); } catch { /* ignore */ }
    rmSync(armHome, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveC2();
  const dest = process.argv[2] || join(repo, "artifacts/v5-tasks/T26/g3-c2.json");
  writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, note: result.note, historyCalled: result.historyCalled, nonceInOutput: result.nonceInOutput, recoveryPathProven: result.recoveryPathProven, compact: result.compact, isolation: result.isolation }, null, 2));
  process.exit(result.status === "passed" ? 0 : result.status === "blocked" ? 2 : 1);
}

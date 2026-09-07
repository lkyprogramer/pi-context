#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function canonicalModelId(model) {
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function writeResult(payload) {
  writeFileSync("/work/agent-result.json", `${JSON.stringify(payload, null, 2)}\n`);
}

const result = {
  kind: "g4-agent",
  status: "failed",
  plugin: null,
  tools: [],
  lastAssistant: "",
  files: [],
  error: null,
};

try {
  const home = process.env.HOME || "/home/node";
  const agentDir = join(home, ".pi", "agent");
  const pluginDir = join(agentDir, "plugins", "pi-context");
  mkdirSync(pluginDir, { recursive: true });
  const tarball = existsSync("/tarball/plugin.tgz") ? "/tarball/plugin.tgz" : "";
  if (tarball) {
    execFileSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", pluginDir], { stdio: "pipe" });
  }
  mkdirSync(join(agentDir), { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
    extensions: [join(pluginDir, "dist", "extension.js")],
    defaultProjectTrust: "always",
  }, null, 2)}\n`);

  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const pi = await import(pathToFileURL(join(npmRoot, "@earendil-works/pi-coding-agent/dist/index.js")).href);
  const settings = pi.SettingsManager.create("/work", agentDir, { projectTrusted: true });
  const loader = new pi.DefaultResourceLoader({
    cwd: "/work",
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  result.plugin = {
    errors: loaded.errors ?? [],
    paths: (loaded.extensions ?? []).map((ext) => ext.resolvedPath ?? ext.path ?? ""),
    commands: (loaded.extensions ?? []).flatMap((ext) => [...(ext.commands?.keys?.() ?? [])]),
  };

  const provider = process.env.PCR_LIVE_PROVIDER || "openclaw";
  const model = process.env.PCR_LIVE_MODEL || "smoke";
  const modelId = canonicalModelId(model);
  const runtime = await pi.ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerProvider(provider, {
    api: "openai-completions",
    baseUrl: process.env.PCR_BROKER_URL || "http://127.0.0.1:8080/v1",
    apiKey: "pcr-broker",
    authHeader: true,
    models: [{
      id: modelId,
      name: modelId,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 2048,
    }],
  });
  const resolved = runtime.getModel(provider, modelId);
  if (!resolved) throw new Error("model not resolved");
  const manager = pi.SessionManager.create("/work", join("/work", "sessions"));
  const { session } = await pi.createAgentSession({
    cwd: "/work",
    agentDir,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: manager,
    modelRuntime: runtime,
    model: resolved,
  });
  result.tools = session.getActiveToolNames?.() ?? [];
  const prompt = readFileSync("/work/TASK.md", "utf8");
  await session.prompt(prompt);
  await session.dispose?.();
  const entries = manager.getEntries?.() ?? [];
  const last = [...entries].reverse().find((e) => e.message?.role === "assistant");
  const content = last?.message?.content;
  result.lastAssistant = typeof content === "string"
    ? content.slice(0, 500)
    : Array.isArray(content)
      ? content.map((b) => b.text ?? "").join("").slice(0, 500)
      : "";
  result.files = readdirSync("/work").filter((name) => name.endsWith(".java") || name === "TASK.md");
  result.status = "ok";
} catch (error) {
  result.status = "failed";
  result.error = String(error).slice(0, 1200);
} finally {
  try {
    result.files = readdirSync("/work").filter((name) => !name.startsWith("."));
  } catch {
    /* ignore */
  }
  writeResult(result);
  if (result.status !== "ok") process.exit(1);
}

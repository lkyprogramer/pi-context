#!/usr/bin/env node
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const cwd = "/work";
const agentDir = "/home/node/.pi/agent";
const sessionDir = "/tmp/sessions";
const out = "/out";
mkdirSync(sessionDir, { recursive: true });

const require = createRequire(import.meta.url);
let piRoot;
try {
  piRoot = dirname(require.resolve("@earendil-works/pi-coding-agent/package.json"));
} catch {
  piRoot = "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent";
}
const pi = await import(pathToFileURL(join(piRoot, "dist/index.js")).href);
const prompts = JSON.parse(readFileSync(process.env.PCTX_PROMPTS || join(out, "prompts.json"), "utf8"));
const seedCopy = process.env.PCTX_SEED && existsSync(process.env.PCTX_SEED) ? process.env.PCTX_SEED : null;
const BUDGET = { wallMs: 900_000, modelCalls: 40, toolCalls: 80 };

const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: false });
await loader.reload();
const runtime = await pi.ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
const model = runtime.getModel("work", "openclaw/Qwen3.8-27B-WORK");
if (!model) throw new Error("model not resolved from models.json");
const sessionManager = seedCopy ? pi.SessionManager.open(seedCopy, sessionDir, cwd) : pi.SessionManager.create(cwd, sessionDir);
const { session } = await pi.createAgentSession({
  cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager, modelRuntime: runtime, model, thinkingLevel: "medium",
});
await session.bindExtensions?.({ uiContext: { notify() {} } });

let modelCalls = 0, toolCalls = 0;
const started = Date.now();
let reqStartedAt = null, firstTokenAt = null;
const ev = (o) => appendFileSync(join(out, "events.jsonl"), `${JSON.stringify({ at: Date.now() - started, ...o })}\n`);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const unsubscribe = session.subscribe((e) => {
  switch (e.type) {
    case "message_start":
      if (e.message?.role === "assistant") { reqStartedAt = Date.now(); firstTokenAt = null; }
      break;
    case "message_update":
      if (e.message?.role === "assistant" && firstTokenAt === null && reqStartedAt !== null) firstTokenAt = Date.now();
      break;
    case "message_end": {
      const m = e.message;
      if (m.role === "assistant") {
        modelCalls++;
        const usage = m.usage ?? {};
        const ttftMs = reqStartedAt !== null && firstTokenAt !== null ? firstTokenAt - reqStartedAt : null;
        const rec = {
          at: new Date().toISOString(),
          usage: { input: usage.input ?? null, output: usage.output ?? null, cacheRead: usage.cacheRead ?? null, cacheWrite: usage.cacheWrite ?? null, totalTokens: usage.totalTokens ?? null },
          stopReason: m.stopReason ?? null,
          contextPercentBefore: session.getContextUsage?.()?.percent ?? null,
          ttftMs,
          totalMs: reqStartedAt !== null ? Date.now() - reqStartedAt : null,
        };
        reqStartedAt = null; firstTokenAt = null;
        appendFileSync(join(out, "requests.jsonl"), `${JSON.stringify(rec)}\n`);
        ev({ type: "assistant", usage: rec.usage, stopReason: rec.stopReason });
      }
      break;
    }
    case "tool_execution_start":
      toolCalls++;
      ev({ type: "tool_start", toolName: e.toolName, toolCallId: e.toolCallId, argsSha256: sha256(JSON.stringify(e.args ?? {})), action: e.toolName === "pctx_history" ? e.args?.action ?? null : undefined });
      break;
    case "tool_execution_end": {
      const body = JSON.stringify(e.result ?? "");
      ev({ type: "tool_end", toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError, bytes: Buffer.byteLength(body), sha256: sha256(body) });
      break;
    }
    case "compaction_start": ev({ type: "compaction_start", reason: e.reason }); break;
    case "compaction_end": ev({ type: "compaction_end", reason: e.reason, aborted: e.aborted, willRetry: e.willRetry, tokensBefore: e.result?.tokensBefore ?? null }); break;
    default: break;
  }
});

let status = "complete";
try {
  for (const p of prompts) {
    if (Date.now() - started > BUDGET.wallMs || modelCalls > BUDGET.modelCalls || toolCalls > BUDGET.toolCalls) { status = "timeout"; break; }
    ev({ type: "prompt", sha256: sha256(p), chars: p.length });
    await session.prompt(p);
  }
} finally {
  unsubscribe();
  try { await session.prompt("/pctx status --json"); } catch { /* native arm */ }
  const file = sessionManager.getSessionFile?.();
  if (file && existsSync(file)) {
    mkdirSync(join(out, "session"), { recursive: true });
    cpSync(file, join(out, "session", "session.jsonl"));
  }
  await session.dispose?.();
}
writeFileSync(join(out, "container-status.json"), JSON.stringify({ status, modelCalls, toolCalls }));
if (status !== "complete") process.exit(status === "timeout" ? 124 : 1);

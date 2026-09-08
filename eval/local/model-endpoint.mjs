/**
 * Live eval endpoint. Default is the user-designated OpenAI-compatible NInfer
 * gateway. API keys are read from the gitignored repo `.env` (PCR_LIVE_API_KEY)
 * or process env; they are never written into tracked files.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "http://47.106.205.246:1082/v1";
export const EXPECT_MODEL = "openclaw/Qwen3.8-27B-WORK";
export const EXPECT_CTX = 262144;

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function loadRepoEnv(repo = repoRoot()) {
  const p = join(repo, ".env");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] == null) process.env[k] = v;
  }
}

export function modelEndpoint() {
  loadRepoEnv();
  const baseUrl = String(process.env.PCTX_MODEL_BASE_URL || process.env.PCR_LIVE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey = process.env.PCTX_MODEL_API_KEY || process.env.PCR_LIVE_API_KEY || "";
  const expectModel = process.env.PCTX_EXPECT_MODEL || EXPECT_MODEL;
  const expectCtx = Number(process.env.PCTX_EXPECT_CTX || EXPECT_CTX);
  const origin = new URL(baseUrl).origin;
  return { baseUrl, apiKey, expectModel, expectCtx, modelsUrl: `${baseUrl}/models`, metricsUrl: `${origin}/metrics` };
}

export function fetchModels() {
  const { modelsUrl, apiKey } = modelEndpoint();
  const args = ["-fsS", "--max-time", "15", modelsUrl];
  if (apiKey) args.splice(3, 0, "-H", `Authorization: Bearer ${apiKey}`);
  return JSON.parse(execFileSync("curl", args, { encoding: "utf8" }));
}

export function servedIdentity(models) {
  const served = models?.data?.[0] ?? null;
  const nCtx = Number(served?.meta?.n_ctx ?? served?.context_window ?? 0);
  return { served, id: served?.id ?? null, nCtx };
}

export function engineOk(models) {
  const { expectModel, expectCtx } = modelEndpoint();
  const { id, nCtx } = servedIdentity(models);
  return id === expectModel && nCtx === expectCtx;
}

export function applyEndpointToModelsJson(path) {
  const { baseUrl, apiKey } = modelEndpoint();
  const data = JSON.parse(readFileSync(path, "utf8"));
  const prov = data?.providers?.work;
  if (!prov) return;
  prov.baseUrl = baseUrl;
  if (apiKey) prov.apiKey = apiKey;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

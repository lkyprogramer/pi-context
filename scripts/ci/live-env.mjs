#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/**
 * @typedef {object} LiveCiPolicy
 * @property {string[]} requiredSecrets
 * @property {number} maxConcurrency
 * @property {number} artifactRetentionDays
 */

export const LIVE_CI_POLICY = Object.freeze({
  requiredSecrets: Object.freeze(["PCR_LIVE_PROVIDER_KEY", "PCR_LIVE_MODEL"]),
  maxConcurrency: 1,
  artifactRetentionDays: 14,
});

export const LIVE_CI_SEEDS = Object.freeze([7, 11, 23]);

const EMPTY_DIFF_HASH = createHash("sha256").update("").digest("hex");

export class LiveCiError extends TypeError {
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, details = {}) {
    super(code);
    this.name = "LiveCiError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency) {
  throw new LiveCiError("PCR_LIVE_CI_DEPENDENCY_MISSING", { dependency });
}

function failInput(field) {
  throw new LiveCiError("PCR_LIVE_CI_INPUT_INVALID", { field });
}

function failScope(details = {}) {
  throw new LiveCiError("PCR_LIVE_CI_SCOPE_MISMATCH", details);
}

function failSecret(secret) {
  throw new LiveCiError("PCR_LIVE_CI_SECRET_MISSING", { secret });
}

function failDirty(details = {}) {
  throw new LiveCiError("PCR_LIVE_CI_DIRTY_TREE", details);
}

function requireNonEmpty(value, field) {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

/**
 * @param {{ workspaceId: string, env: { get: (name: string) => string | undefined }, git: { status: Function } }} input
 */
export function createLiveCiEnv(input) {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMissing("workspaceId");
  if (!input.env || typeof input.env.get !== "function") failMissing("env");
  if (!input.git || typeof input.git.status !== "function") failMissing("git");
  const workspaceId = input.workspaceId;
  const env = input.env;
  const git = input.git;
  return {
    /** @returns {LiveCiPolicy} */
    policy() {
      return {
        requiredSecrets: [...LIVE_CI_POLICY.requiredSecrets],
        maxConcurrency: LIVE_CI_POLICY.maxConcurrency,
        artifactRetentionDays: LIVE_CI_POLICY.artifactRetentionDays,
      };
    },
    /**
     * @param {{ seeds: number[], workspaceId?: string, runSeed?: number, signal?: AbortSignal }} request
     */
    async prepare(request) {
      if (!request || typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      const scopeId = request.workspaceId === undefined ? workspaceId : request.workspaceId;
      requireNonEmpty(scopeId, "workspaceId");
      if (scopeId !== workspaceId) failScope({ workspaceId: scopeId });
      if (!Array.isArray(request.seeds) || request.seeds.length !== 3) failInput("seeds");
      const seeds = [];
      const seen = new Set();
      for (const [index, seed] of request.seeds.entries()) {
        if (!Number.isSafeInteger(seed)) failInput(`seeds[${index}]`);
        if (seen.has(seed)) failInput(`seeds[${index}]`);
        seen.add(seed);
        seeds.push(seed);
      }
      if (request.runSeed !== undefined && !seen.has(request.runSeed)) failInput("runSeed");
      request.signal?.throwIfAborted();
      let snapshot;
      try {
        snapshot = await git.status({ workspaceId: scopeId }, request.signal);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
          failScope({ workspaceId: scopeId, port: "git" });
        }
        throw error;
      }
      if (!snapshot || snapshot.dirty === true || snapshot.diffHash !== EMPTY_DIFF_HASH) {
        failDirty({ dirty: snapshot?.dirty === true });
      }
      for (const secret of LIVE_CI_POLICY.requiredSecrets) {
        request.signal?.throwIfAborted();
        const value = env.get(secret);
        if (typeof value !== "string" || value.length === 0) failSecret(secret);
      }
      return Object.freeze({
        seeds: Object.freeze([...seeds]),
        policy: {
          requiredSecrets: [...LIVE_CI_POLICY.requiredSecrets],
          maxConcurrency: LIVE_CI_POLICY.maxConcurrency,
          artifactRetentionDays: LIVE_CI_POLICY.artifactRetentionDays,
        },
        provenance: Object.freeze({
          dirty: false,
          diffHash: EMPTY_DIFF_HASH,
          commit: typeof snapshot.commit === "string" ? snapshot.commit : "",
        }),
      });
    },
  };
}

function processEnv() {
  return {
    get(name) {
      const value = process.env[name];
      return typeof value === "string" ? value : undefined;
    },
  };
}

function processGit() {
  return {
    async status() {
      const porcelain = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
      const diff = execFileSync("git", ["diff", "HEAD"], { encoding: "utf8" });
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      return {
        commit,
        dirty: porcelain.trim().length > 0,
        diffHash: createHash("sha256").update(diff).digest("hex"),
      };
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", default: "live" },
      seeds: { type: "string", default: LIVE_CI_SEEDS.join(",") },
      "run-seed": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const seeds = values.seeds.split(",").map((item) => Number(item));
  const runSeed = values["run-seed"] === undefined ? undefined : Number(values["run-seed"]);
  const live = createLiveCiEnv({
    workspaceId: values.workspace,
    env: processEnv(),
    git: processGit(),
  });
  const ready = await live.prepare({ seeds, runSeed });
  process.stdout.write(`${JSON.stringify({ ok: true, seeds: ready.seeds, policy: ready.policy })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const code = error instanceof LiveCiError ? error.code : "PCR_LIVE_CI_INPUT_INVALID";
    process.stderr.write(`${code}\n`);
    process.exit(1);
  });
}

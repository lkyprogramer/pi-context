#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {object} CompatibilityCell
 * @property {string} node
 * @property {string} os
 * @property {string} pi
 * @property {"pass"|"fail"} status
 * @property {string} evidence
 */

export class CompatibilityMatrixError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "CompatibilityMatrixError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STATUSES = new Set(["pass", "fail"]);

function failMissing(dependency) {
  throw new CompatibilityMatrixError("PCR_COMPAT_DEPENDENCY_MISSING", { dependency });
}

function failInput(field) {
  throw new CompatibilityMatrixError("PCR_COMPAT_INPUT_INVALID", { field });
}

function failScope(details = {}) {
  throw new CompatibilityMatrixError("PCR_COMPAT_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value, field) {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotList(value, field) {
  if (!Array.isArray(value) || value.length === 0) failInput(field);
  return value.map((item, index) => {
    requireNonEmpty(item, `${field}[${index}]`);
    return item;
  });
}

function cartesian(lock) {
  const cells = [];
  for (const node of lock.node) {
    for (const os of lock.os) {
      for (const pi of lock.pi) {
        cells.push({ node, os, pi });
      }
    }
  }
  return cells;
}

export function createCompatibilityMatrix(input) {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMissing("workspaceId");
  if (!input.lock || typeof input.lock !== "object") failMissing("lock");
  if (!input.probe || typeof input.probe.run !== "function") failMissing("probe");
  const workspaceId = input.workspaceId;
  const lock = {
    node: snapshotList(input.lock.node, "lock.node"),
    os: snapshotList(input.lock.os, "lock.os"),
    pi: snapshotList(input.lock.pi, "lock.pi"),
  };
  const probe = input.probe;
  const planned = cartesian(lock);
  return {
    /**
     * @param {{ workspaceId: string, signal?: AbortSignal }} request
     * @returns {Promise<CompatibilityCell[]>}
     */
    async evaluate(request) {
      if (!request || typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      requireNonEmpty(request.workspaceId, "workspaceId");
      if (request.workspaceId !== workspaceId) failScope({ workspaceId: request.workspaceId });
      const cells = [];
      for (const plan of planned) {
        request.signal?.throwIfAborted();
        const result = await probe.run({ ...plan, signal: request.signal });
        if (!result || typeof result !== "object") failInput("probe");
        if (!STATUSES.has(result.status)) failInput("probe.status");
        requireNonEmpty(result.evidence, "probe.evidence");
        if (!SHA256_PATTERN.test(result.evidence)) failInput("probe.evidence");
        cells.push(Object.freeze({
          node: plan.node,
          os: plan.os,
          pi: plan.pi,
          status: result.status,
          evidence: result.evidence,
        }));
      }
      return Object.freeze(cells);
    },
  };
}

export function loadToolchainLock(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const path = join(root, "compat/toolchain.lock.json");
  const piPath = join(root, "compat/pi.lock.json");
  const toolchain = JSON.parse(readFileSync(path, "utf8"));
  const pi = JSON.parse(readFileSync(piPath, "utf8"));
  return {
    node: [...(toolchain.node?.required ?? []), ...(toolchain.node?.advisory ?? [])],
    os: [...(toolchain.os?.required ?? [])],
    pi: [pi.supportedRange],
    pnpm: toolchain.pnpm,
    required: {
      node: [...(toolchain.node?.required ?? [])],
      os: [...(toolchain.os?.required ?? [])],
    },
  };
}

export function hashEvidenceDir(logDir) {
  if (typeof logDir !== "string" || logDir.length === 0 || !existsSync(logDir)) failInput("logDir");
  const names = readdirSync(logDir).filter((name) => name.endsWith(".log")).sort();
  if (names.length === 0) failInput("logDir");
  const hash = createHash("sha256");
  let failed = false;
  for (const name of names) {
    const body = readFileSync(join(logDir, name));
    hash.update(name);
    hash.update(body);
    const text = body.toString("utf8");
    if (/\bFAIL\b|ELIFECYCLE|ERR_PNPM|Command failed/u.test(text)) failed = true;
  }
  return { evidence: hash.digest("hex"), status: failed ? "fail" : "pass" };
}

async function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", default: "ci" },
      node: { type: "string" },
      os: { type: "string" },
      pi: { type: "string" },
      "log-dir": { type: "string" },
      out: { type: "string", default: "artifacts/compat/cell.json" },
    },
    strict: true,
    allowPositionals: false,
  });
  requireNonEmpty(values.node, "node");
  requireNonEmpty(values.os, "os");
  requireNonEmpty(values.pi, "pi");
  requireNonEmpty(values["log-dir"], "log-dir");
  const observed = hashEvidenceDir(values["log-dir"]);
  const matrix = createCompatibilityMatrix({
    workspaceId: values.workspace,
    lock: { node: [values.node], os: [values.os], pi: [values.pi] },
    probe: {
      async run() {
        return observed;
      },
    },
  });
  const cells = await matrix.evaluate({ workspaceId: values.workspace });
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ cells }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, cells })}\n`);
  if (cells.some((cell) => cell.status === "fail")) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const code = error instanceof CompatibilityMatrixError ? error.code : "PCR_COMPAT_INPUT_INVALID";
    process.stderr.write(`${code}\n`);
    process.exit(1);
  });
}

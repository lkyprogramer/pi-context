#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {object} ReleaseManifest
 * @property {string} version
 * @property {string} commit
 * @property {string} packageHash
 * @property {string} compatHash
 * @property {string} gateBundleHash
 * @property {string} rollbackDrillHash
 */

export class ReleasePublisherError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "ReleasePublisherError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const EMPTY_DIFF = createHash("sha256").update("").digest("hex");

function failMissing(dependency) {
  throw new ReleasePublisherError("PCR_RELEASE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field) {
  throw new ReleasePublisherError("PCR_RELEASE_INPUT_INVALID", { field });
}

function failScope(details = {}) {
  throw new ReleasePublisherError("PCR_RELEASE_SCOPE_MISMATCH", details);
}

function failDirty(details = {}) {
  throw new ReleasePublisherError("PCR_RELEASE_DIRTY_TREE", details);
}

function requireHash(value, field) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) failInput(field);
}

export function createReleasePublisher(input) {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMissing("workspaceId");
  if (typeof input.version !== "string" || input.version.length === 0) failMissing("version");
  if (!input.git || typeof input.git.status !== "function") failMissing("git");
  if (!input.artifacts || typeof input.artifacts !== "object") failMissing("artifacts");
  for (const name of ["packageHash", "compatHash", "gateBundleHash", "rollbackDrill"]) {
    if (typeof input.artifacts[name] !== "function") failMissing(`artifacts.${name}`);
  }
  if (!input.files || typeof input.files.writeFile !== "function") failMissing("files");
  const workspaceId = input.workspaceId;
  const version = input.version;
  const git = input.git;
  const artifacts = input.artifacts;
  const files = input.files;
  return {
    /**
     * @param {{ workspaceId: string, out?: string, signal?: AbortSignal }} request
     * @returns {Promise<ReleaseManifest>}
     */
    async publish(request) {
      if (!request || typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      if (typeof request.workspaceId !== "string" || request.workspaceId.length === 0) failInput("workspaceId");
      if (request.workspaceId !== workspaceId) failScope({ workspaceId: request.workspaceId });
      request.signal?.throwIfAborted();
      let snapshot;
      try {
        snapshot = await git.status({ workspaceId }, request.signal);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
          failScope({ workspaceId, port: "git" });
        }
        throw error;
      }
      if (!snapshot || snapshot.dirty === true || snapshot.diffHash !== EMPTY_DIFF) {
        failDirty({ dirty: snapshot?.dirty === true });
      }
      if (typeof snapshot.commit !== "string" || !COMMIT_PATTERN.test(snapshot.commit)) failInput("git.commit");
      request.signal?.throwIfAborted();
      const packageHash = await artifacts.packageHash(request.signal);
      requireHash(packageHash, "packageHash");
      request.signal?.throwIfAborted();
      const compatHash = await artifacts.compatHash(request.signal);
      requireHash(compatHash, "compatHash");
      request.signal?.throwIfAborted();
      const gateBundleHash = await artifacts.gateBundleHash(request.signal);
      requireHash(gateBundleHash, "gateBundleHash");
      request.signal?.throwIfAborted();
      const drill = await artifacts.rollbackDrill(request.signal);
      if (!drill || typeof drill !== "object") failInput("rollbackDrill");
      requireHash(drill.hash, "rollbackDrillHash");
      const manifest = Object.freeze({
        version,
        commit: snapshot.commit,
        packageHash,
        compatHash,
        gateBundleHash,
        rollbackDrillHash: drill.hash,
      });
      const out = typeof request.out === "string" && request.out.length > 0 ? request.out : "release/manifest.json";
      request.signal?.throwIfAborted();
      await files.writeFile(out, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
      return manifest;
    },
  };
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Files(root, relativePaths) {
  if (typeof root !== "string" || root.length === 0) failInput("root");
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) failInput("paths");
  const hash = createHash("sha256");
  for (const rel of relativePaths) {
    if (
      typeof rel !== "string"
      || rel.length === 0
      || rel.startsWith("/")
      || rel.includes("\\")
      || rel.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      failInput("path");
    }
    hash.update(rel);
    hash.update(readFileSync(join(root, rel)));
  }
  return hash.digest("hex");
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

function processFiles() {
  return {
    async writeFile(path, bytes) {
      mkdirSync(dirname(resolve(path)), { recursive: true });
      writeFileSync(resolve(path), bytes);
    },
  };
}

export function processArtifacts(root, env = process.env) {
  if (typeof root !== "string" || root.length === 0) failInput("root");
  const environ = env && typeof env === "object" ? env : {};
  return {
    async packageHash() {
      const tarball = environ.PCR_RELEASE_TARBALL;
      if (typeof tarball !== "string" || tarball.length === 0) {
        throw new ReleasePublisherError("PCR_RELEASE_INPUT_INVALID", { field: "PCR_RELEASE_TARBALL" });
      }
      return sha256File(tarball);
    },
    async compatHash() {
      return sha256Files(root, [
        "compat/toolchain.lock.json",
        "compat/pi.lock.json",
      ]);
    },
    async gateBundleHash() {
      const bundle = environ.PCR_RELEASE_GATE_BUNDLE;
      if (typeof bundle !== "string" || bundle.length === 0) {
        throw new ReleasePublisherError("PCR_RELEASE_INPUT_INVALID", { field: "PCR_RELEASE_GATE_BUNDLE" });
      }
      return sha256File(bundle);
    },
    async rollbackDrill() {
      const path = join(root, "release/rollback-drill.md");
      return { hash: sha256File(path), log: readFileSync(path, "utf8") };
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const publisher = createReleasePublisher({
    workspaceId: "release",
    version: "0.1.0-alpha.1",
    git: processGit(),
    artifacts: processArtifacts(root),
    files: processFiles(),
  });
  publisher.publish({ workspaceId: "release", out: join(root, "release/manifest.json") }).then((manifest) => {
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  }).catch((error) => {
    const code = error instanceof ReleasePublisherError ? error.code : "PCR_RELEASE_INPUT_INVALID";
    process.stderr.write(`${code}\n`);
    process.exit(1);
  });
}

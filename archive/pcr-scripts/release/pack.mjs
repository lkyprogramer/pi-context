#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  installAndRunVerticalProbe as installPackedProbe,
  packCurrentSource as packSmokeSource,
} from "../pack-smoke.mjs";
import { createSbom } from "./build-release.mjs";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @typedef {object} ReleasePackage
 * @property {string} tarball
 * @property {string} sha256
 * @property {string} sbom
 * @property {string} cleanInstallLog
 */

export class ReleasePackError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "ReleasePackError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency) {
  throw new ReleasePackError("PCR_RELEASE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field) {
  throw new ReleasePackError("PCR_RELEASE_INPUT_INVALID", { field });
}

function resolveRepoRoot(repoRoot) {
  const root = repoRoot === undefined ? DEFAULT_ROOT : repoRoot;
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) failInput("repoRoot");
  return root;
}

export async function packCurrentSource(opts = {}) {
  return packSmokeSource({ ...opts, repoRoot: resolveRepoRoot(opts.repoRoot) });
}

export async function installAndRunVerticalProbe(packed, opts = {}) {
  return installPackedProbe(packed, { ...opts, repoRoot: resolveRepoRoot(opts.repoRoot) });
}

export function createReleasePacker(input) {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.repoRoot !== "string" || input.repoRoot.length === 0) failMissing("repoRoot");
  const repoRoot = resolveRepoRoot(input.repoRoot);
  return {
    /**
     * @param {{ outDir?: string, tempRoot?: string, signal?: AbortSignal }} [request]
     * @returns {Promise<ReleasePackage>}
     */
    async pack(request = {}) {
      if (request && typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      const packed = await packCurrentSource({
        repoRoot,
        outDir: request.outDir,
        signal: request.signal,
      });
      request.signal?.throwIfAborted();
      const probe = await installAndRunVerticalProbe(packed, {
        repoRoot,
        tempRoot: request.tempRoot,
        signal: request.signal,
      });
      const outDir = request.outDir ? resolve(request.outDir) : dirname(packed.tarball);
      mkdirSync(outDir, { recursive: true });
      const pkg = JSON.parse(readFileSync(join(repoRoot, "apps/pi-context-runtime/package.json"), "utf8"));
      const sbom = await createSbom(packed.tarball, pkg);
      const sbomPath = join(outDir, "sbom.json");
      const logPath = join(outDir, "clean-install.log");
      writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
      writeFileSync(
        logPath,
        `${JSON.stringify({
          loaded: probe.loaded === true,
          verticalProbePassed: probe.verticalProbePassed === true,
          sha256: packed.sha256,
          entry: packed.entry,
          piVersion: probe.piVersion ?? null,
        }, null, 2)}\n`,
      );
      return Object.freeze({
        tarball: packed.tarball,
        sha256: packed.sha256,
        sbom: sbomPath,
        cleanInstallLog: logPath,
      });
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const packer = createReleasePacker({ repoRoot: DEFAULT_ROOT });
  const release = await packer.pack();
  process.stdout.write(`${JSON.stringify({ tarball: release.tarball, sha256: release.sha256, sbom: release.sbom })}\n`);
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPiContextExtension } from "../../apps/pi-context-runtime/src/extension.ts";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.ts";
import {
  buildReleaseArtifact,
  defaultReleaseInput,
  hashArtifactSet,
  sha256File,
} from "./build-release.mjs";

export async function verifyReleaseArtifact(receipt, input) {
  const recomputed = await hashArtifactSet([receipt.tarball, receipt.sbom, ...input.docs]);
  const packedPkg = JSON.parse(
    spawnSync("tar", ["-xOf", receipt.tarball, "package/package.json"], { encoding: "utf8" }).stdout,
  );
  const temporaryPiE = { entry: "./dist/extension.js", loaded: false };
  resetOwnerForTest();
  const ext = createPiContextExtension({ claimOnCreate: true });
  temporaryPiE.loaded = ext.name === "pi-context-runtime" && ext.claimed === true;
  ext.release?.();
  resetOwnerForTest();
  return {
    piExtensions: packedPkg.pi?.extensions ?? [],
    privatePiImports: receipt.cleanHome.privatePiImports,
    manifestVerified: recomputed.digest === receipt.manifest.digest && sha256File(receipt.tarball) === receipt.manifest.files[0]?.sha256,
    secrets: receipt.cleanHome.secrets,
    semanticDefault: receipt.semanticDefault,
    t45Decision: receipt.t45Decision,
    supportedRange: input.compatLock.supportedRange,
    unsupportedHidden: receipt.cleanHome.unsupportedHidden,
    nodeMatrix: receipt.cleanHome.nodeMatrix,
    cleanHome: receipt.cleanHome,
    temporaryPiE,
    rollback: receipt.rollback,
    version: receipt.version,
    size: readFileSync(receipt.tarball).byteLength,
    publicationClaim: receipt.publicationClaim,
  };
}

export async function inspectPackedRelease(root = process.cwd()) {
  const input = await defaultReleaseInput(root);
  const receipt = await buildReleaseArtifact(input);
  return verifyReleaseArtifact(receipt, input);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = await inspectPackedRelease(root);
  console.log(JSON.stringify({ manifestVerified: report.manifestVerified, piExtensions: report.piExtensions, semanticDefault: report.semanticDefault }, null, 2));
  if (!report.manifestVerified || report.privatePiImports.length > 0 || report.secrets.length > 0) process.exit(1);
}

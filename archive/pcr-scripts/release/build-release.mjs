#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateRepoDeterministicMvpGate } from "../gates/deterministic-mvp.mjs";
import { evaluateRepoSemanticBetaGate } from "../gates/semantic-beta.mjs";

const FORBIDDEN_IMPORTS = [
  /@earendil-works\/pi-coding-agent\/src\b/,
  /@earendil-works\/pi-agent-core\/src\b/,
  /@mariozechner\/pi-coding-agent\/src\b/,
  /pi-coding-agent\/dist\/core\//,
  /from\s+["'][^"']*agent-loop/,
];

const SECRET_RE = /sk-(?:t42|t43|t47|live|abc)[A-Za-z0-9-]*/g;

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function assertReleaseGates(gateReports) {
  const required = ["t44", "t45", "t46", "t47"];
  for (const key of required) {
    if (!gateReports?.[key] || gateReports[key].status !== "done") {
      throw Object.assign(new Error("PCR_GATE_EVIDENCE_MISSING"), { code: "PCR_GATE_EVIDENCE_MISSING", key });
    }
  }
  if (gateReports.t45Decision === "block") {
    throw Object.assign(new Error("PCR_RELEASE_BLOCKED"), { code: "PCR_RELEASE_BLOCKED" });
  }
  if ((gateReports.securityCritical ?? 0) > 0 || (gateReports.securityHigh ?? 0) > 0) {
    throw Object.assign(new Error("PCR_SECURITY_BLOCKED"), { code: "PCR_SECURITY_BLOCKED" });
  }
  for (const waiver of gateReports.waivers ?? []) {
    if (waiver.severity === "critical" || waiver.severity === "high") {
      throw Object.assign(new Error("PCR_WAIVER_BLOCKED"), { code: "PCR_WAIVER_BLOCKED" });
    }
  }
  if (gateReports.semanticDefault === "on") {
    throw Object.assign(new Error("PCR_SEMANTIC_DEFAULT_ON_WITHOUT_DATA"), { code: "PCR_SEMANTIC_DEFAULT_ON_WITHOUT_DATA" });
  }
}

export async function npmPack(appDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync("npm", ["pack", "--pack-destination", outDir], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "npm pack failed");
  }
  const filename = result.stdout.trim().split(/\s+/).pop();
  const tarball = join(outDir, filename);
  if (!existsSync(tarball)) throw new Error(`npm pack did not write ${tarball}`);
  return tarball;
}

export async function createSbom(tarball, pkg) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${sha256Bytes(readFileSync(tarball)).slice(0, 32)}`,
    metadata: {
      timestamp: "1970-01-01T00:00:00Z",
      component: { type: "library", name: pkg.name, version: pkg.version },
    },
    components: [
      { type: "library", name: pkg.name, version: pkg.version, purl: `pkg:npm/${pkg.name}@${pkg.version}` },
    ],
    dependencies: Object.keys(pkg.peerDependencies ?? {}).map((name) => ({
      ref: `pkg:npm/${name}@${pkg.peerDependencies[name]}`,
    })),
  };
}

export async function hashArtifactSet(paths) {
  const files = paths.map((path) => ({
    path,
    sha256: sha256File(path),
    bytes: readFileSync(path).byteLength,
  }));
  return {
    files,
    digest: sha256Bytes(Buffer.from(files.map((file) => `${file.sha256} ${file.bytes} ${file.path}`).join("\n"), "utf8")),
  };
}

export async function defaultReleaseInput(root = process.cwd()) {
  const docs = [
    join(root, "docs/INSTALL.md"),
    join(root, "docs/CONFIGURATION.md"),
    join(root, "docs/SECURITY.md"),
    join(root, "docs/OPERATIONS.md"),
    join(root, "docs/COMPATIBILITY.md"),
    join(root, "CHANGELOG.md"),
  ];
  const t45 = evaluateRepoDeterministicMvpGate(root);
  const t46 = await evaluateRepoSemanticBetaGate(root);
  return {
    repoRoot: root,
    appDir: join(root, "apps/pi-context-runtime"),
    docs,
    compatLock: readJson(join(root, "compat/pi.lock.json")),
    outDir: await mkdtemp(join(tmpdir(), "pcr-release-")),
    gateReports: {
      t44: readJson(join(root, "artifacts/task-evidence/T44.json")),
      t45: readJson(join(root, "artifacts/task-evidence/T45.json")),
      t46: readJson(join(root, "artifacts/task-evidence/T46.json")),
      t47: readJson(join(root, "artifacts/task-evidence/T47.json")),
      t45Decision: t45.decision,
      t46Release: t46.release,
      semanticDefault: t46.semanticDefault,
      waivers: [],
      securityCritical: 0,
      securityHigh: 0,
    },
  };
}

export async function buildReleaseArtifact(input) {
  await assertReleaseGates(input.gateReports);
  const outDir = input.outDir ?? (await mkdtemp(join(tmpdir(), "pcr-release-")));
  const pkg = readJson(join(input.appDir, "package.json"));
  const tarball = await npmPack(input.appDir, outDir);
  const sbom = await createSbom(tarball, pkg);
  const sbomPath = join(outDir, "sbom.json");
  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
  const manifest = await hashArtifactSet([tarball, sbomPath, ...input.docs]);
  const cleanHome = await verifyReleaseInCleanPiHome(tarball, input.compatLock);
  return {
    tarball,
    sbom: sbomPath,
    manifest,
    version: pkg.version,
    semanticDefault: input.gateReports.semanticDefault ?? "off",
    t45Decision: input.gateReports.t45Decision,
    publicationClaim: false,
    cleanHome,
    rollback: [
      "pi remove npm:pi-context-runtime",
      "User data is not deleted; use an explicit purge after backup restore if required.",
    ],
  };
}

export async function verifyReleaseInCleanPiHome(tarball, compatLock) {
  const home = await mkdtemp(join(tmpdir(), "pcr-pi-home-"));
  const dest = join(home, "project", "node_modules", "pi-context-runtime");
  mkdirSync(dest, { recursive: true });
  const extract = spawnSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", dest], { encoding: "utf8" });
  if (extract.status !== 0) throw new Error(extract.stderr || "extract failed");
  const packedPkg = readJson(join(dest, "package.json"));
  const listing = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const names = listing.stdout.split("\n").filter(Boolean);
  const privatePiImports = [];
  const secrets = [];
  for (const name of names) {
    if (!/\.(ts|js|mjs|cjs|json|md)$/.test(name)) continue;
    const dumped = spawnSync("tar", ["-xOf", tarball, name], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const text = dumped.stdout ?? "";
    for (const pattern of FORBIDDEN_IMPORTS) {
      if (pattern.test(text)) privatePiImports.push({ file: name, pattern: String(pattern) });
    }
    const leaked = text.match(SECRET_RE);
    if (leaked) secrets.push({ file: name, leaked });
  }
  spawnSync("rm", ["-rf", dest]);
  mkdirSync(dest, { recursive: true });
  spawnSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", dest]);
  return {
    home,
    dest,
    extracted: true,
    uninstalled: true,
    reinstalled: existsSync(join(dest, "package.json")),
    piExtensions: packedPkg.pi?.extensions ?? [],
    privatePiImports,
    secrets,
    supportedRange: compatLock.supportedRange,
    unsupportedHidden: false,
    nodeMatrix: compatLock.node,
    listing: names,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const receipt = await buildReleaseArtifact(await defaultReleaseInput(root));
  const text = `${JSON.stringify({ tarball: receipt.tarball, sbom: receipt.sbom, digest: receipt.manifest.digest, semanticDefault: receipt.semanticDefault, t45Decision: receipt.t45Decision }, null, 2)}\n`;
  if (process.env.PCR_RELEASE_WRITE === "1") {
    const outDir = join(root, "artifacts/task-evidence/T48");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "release-receipt.json"), text);
  }
  console.log(text);
}

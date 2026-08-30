import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function repositoryPath(repositoryRoot, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new TypeError(`${label} is outside repository scope: ${String(relativePath)}`);
  }
  const absolutePath = resolve(repositoryRoot, relativePath);
  const scopedPath = relative(repositoryRoot, absolutePath);
  if (scopedPath === "" || scopedPath === ".." || scopedPath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new TypeError(`${label} is outside repository scope: ${relativePath}`);
  }
  return { absolutePath, scopedPath: scopedPath.replaceAll("\\", "/") };
}

async function canonicalPotentialPath(path) {
  const missingSegments = [];
  let candidate = path;
  while (true) {
    try {
      return resolve(await realpath(candidate), ...missingSegments.reverse());
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

async function repositoryOutputPath(repositoryRoot, outputPath) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new TypeError("output directory is outside repository scope");
  }
  const requestedPath = isAbsolute(outputPath) ? resolve(outputPath) : resolve(repositoryRoot, outputPath);
  const absolutePath = await canonicalPotentialPath(requestedPath);
  const scopedPath = relative(repositoryRoot, absolutePath);
  if (scopedPath === "" || scopedPath === ".." || scopedPath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new TypeError(`output directory is outside repository scope: ${outputPath}`);
  }
  return absolutePath;
}

async function gitObject(repositoryRoot, revision) {
  const { stdout } = await executeFile("git", ["rev-parse", revision], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const objectId = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(objectId)) {
    throw new Error(`git returned an invalid object id for ${revision}`);
  }
  return objectId;
}

async function readExistingBaseline(manifestPath, snapshotPath, manifestContent, snapshotContent) {
  try {
    const [existingManifest, existingSnapshot] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(snapshotPath, "utf8"),
    ]);
    if (existingManifest !== manifestContent || existingSnapshot !== snapshotContent) {
      throw new Error("audit baseline already exists with different content");
    }
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function freezeAuditBaseline(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("baseline input is required");
  }
  const repositoryRoot = await realpath(input.repositoryRoot);
  if (!Array.isArray(input.sourceFiles) || input.sourceFiles.length === 0) {
    throw new TypeError("at least one baseline source is required");
  }

  const sources = input.sourceFiles.map((source) => repositoryPath(repositoryRoot, source, "baseline source"));
  const uniqueSources = new Map(sources.map((source) => [source.scopedPath, source]));
  if (uniqueSources.size !== sources.length) {
    throw new TypeError("baseline sources must be unique");
  }
  const findings = repositoryPath(repositoryRoot, input.findingsFile, "findings file");
  if (!uniqueSources.has(findings.scopedPath)) {
    throw new TypeError("findings file must be included in baseline sources");
  }

  let sourceContents;
  try {
    sourceContents = await Promise.all(
      [...uniqueSources.values()].map(async (source) => [source.scopedPath, await readFile(source.absolutePath)]),
    );
  } catch (error) {
    throw new Error("cannot read baseline source", { cause: error });
  }

  const findingsContent = sourceContents.find(([path]) => path === findings.scopedPath)?.[1];
  let findingsSnapshot;
  try {
    findingsSnapshot = JSON.parse(findingsContent.toString("utf8"));
  } catch (error) {
    throw new Error("findings file is not valid JSON", { cause: error });
  }
  if (!Array.isArray(findingsSnapshot)) {
    throw new TypeError("findings file must contain a JSON array");
  }

  const [commit, tree] = await Promise.all([
    gitObject(repositoryRoot, "HEAD^{commit}"),
    gitObject(repositoryRoot, "HEAD^{tree}"),
  ]);
  const sourceDigests = Object.fromEntries(
    sourceContents
      .map(([path, content]) => [path, sha256(content)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const baseline = { commit, tree, sourceDigests };
  const manifestContent = canonicalJson(baseline);
  const snapshotContent = canonicalJson(findingsSnapshot);

  const outputDirectory = await repositoryOutputPath(repositoryRoot, input.outputDirectory);
  const manifestPath = resolve(outputDirectory, "baseline-manifest.json");
  const snapshotPath = resolve(outputDirectory, "findings.snapshot.json");
  const result = {
    ok: true,
    task: "T00",
    baseline,
    artifacts: { manifest: manifestPath, findingsSnapshot: snapshotPath },
  };
  if (await readExistingBaseline(manifestPath, snapshotPath, manifestContent, snapshotContent)) {
    return result;
  }

  const parentDirectory = dirname(outputDirectory);
  const stagingDirectory = resolve(parentDirectory, `.audit-baseline-${randomUUID()}`);
  await mkdir(parentDirectory, { recursive: true });
  try {
    await mkdir(stagingDirectory);
    await Promise.all([
      writeFile(resolve(stagingDirectory, "baseline-manifest.json"), manifestContent, { encoding: "utf8", flag: "wx" }),
      writeFile(resolve(stagingDirectory, "findings.snapshot.json"), snapshotContent, { encoding: "utf8", flag: "wx" }),
    ]);
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    if (await readExistingBaseline(manifestPath, snapshotPath, manifestContent, snapshotContent)) {
      return result;
    }
    throw error;
  }
  return result;
}

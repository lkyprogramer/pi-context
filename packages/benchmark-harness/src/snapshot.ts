import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBenchmarkContracts, type BoundarySnapshot } from "../../benchmark-contracts/src/index.js";
import { buildLogicalArchive, loadArchive, materializeArchive, type LogicalArchive } from "./archive.js";

export interface SnapshotSource {
  piHome: string;
  workspace: string;
  runtimeStore?: string;
  sessionFile: string;
  branchLeafId: string;
  environmentAllowlist: readonly string[];
}

export interface RestoreTarget {
  piHome: string;
  workspace: string;
  runtimeStore: string;
}

export interface RestoreReceipt {
  readonly workspaceSha256: string;
  readonly branchLeafId: string;
  readonly piHomeSha256: string;
}

export interface StoredBoundarySnapshot extends BoundarySnapshot {
  readonly archiveDir: string;
  readonly sessionLeafId: string;
}

function assertEmptyDir(dir: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (entries.length > 0) {
    throw new Error(`restore target is not empty: ${dir}`);
  }
}

function envSubset(allowlist: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function stored(snapshot: BoundarySnapshot): StoredBoundarySnapshot {
  const extra = snapshot as StoredBoundarySnapshot;
  if (!extra.archiveDir) {
    throw new Error("snapshot missing archiveDir");
  }
  return extra;
}

export async function createBoundarySnapshot(source: SnapshotSource, outDir: string): Promise<StoredBoundarySnapshot> {
  mkdirSync(outDir, { recursive: true });
  const blobs = join(outDir, "blobs");
  const workspace = await buildLogicalArchive(source.workspace, blobs);
  const piHome = await buildLogicalArchive(source.piHome, blobs);
  const runtime = source.runtimeStore ? await buildLogicalArchive(source.runtimeStore, blobs) : { entries: [], sha256: "0".repeat(64) };
  writeFileSync(join(outDir, "workspace.manifest.json"), JSON.stringify(workspace, null, 2));
  writeFileSync(join(outDir, "pi-home.manifest.json"), JSON.stringify(piHome, null, 2));
  writeFileSync(join(outDir, "runtime.manifest.json"), JSON.stringify(runtime, null, 2));
  writeFileSync(join(outDir, "session.jsonl"), readFileSync(source.sessionFile));
  writeFileSync(
    join(outDir, "env.json"),
    JSON.stringify({ allowlist: source.environmentAllowlist, values: envSubset(source.environmentAllowlist) }),
  );
  const snapshot = defineBenchmarkContracts().parseBoundarySnapshot({
    snapshotId: `snap:${source.branchLeafId}`,
    workspaceSnapshotSha256: workspace.sha256,
    boundary: { leafId: source.branchLeafId, kind: "pre-threshold", sourceTokens: workspace.entries.length },
  });
  const storedSnapshot: StoredBoundarySnapshot = {
    ...snapshot,
    archiveDir: outDir,
    sessionLeafId: source.branchLeafId,
  };
  writeFileSync(join(outDir, "snapshot.json"), JSON.stringify(storedSnapshot, null, 2));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ workspace, piHome, runtime }, null, 2));
  return storedSnapshot;
}

export async function restoreBoundarySnapshot(
  snapshot: BoundarySnapshot,
  target: RestoreTarget,
): Promise<RestoreReceipt> {
  assertEmptyDir(target.piHome);
  assertEmptyDir(target.workspace);
  assertEmptyDir(target.runtimeStore);
  const current = stored(snapshot);
  const workspace = loadArchive(join(current.archiveDir, "workspace.manifest.json"));
  const piHome = loadArchive(join(current.archiveDir, "pi-home.manifest.json"));
  const runtime = loadArchive(join(current.archiveDir, "runtime.manifest.json"));
  const blobs = join(current.archiveDir, "blobs");
  await materializeArchive(workspace, blobs, target.workspace);
  await materializeArchive(piHome, blobs, target.piHome);
  await materializeArchive(runtime, blobs, target.runtimeStore);
  const restoredWorkspace = await buildLogicalArchive(target.workspace, mkdtempSync(join(tmpdir(), "pcr-rehash-")));
  return {
    workspaceSha256: restoredWorkspace.sha256,
    branchLeafId: current.boundary.leafId,
    piHomeSha256: piHome.sha256,
  };
}

export async function verifyBoundarySnapshot(snapshot: BoundarySnapshot): Promise<void> {
  const current = stored(snapshot);
  try {
    JSON.parse(readFileSync(join(current.archiveDir, "manifest.json"), "utf8"));
  } catch {
    throw new Error("corrupt manifest");
  }
  const workspace = loadArchive(join(current.archiveDir, "workspace.manifest.json"));
  if (workspace.sha256 !== current.workspaceSnapshotSha256) {
    throw new Error("corrupt archive: workspace hash mismatch");
  }
}

export type { LogicalArchive };

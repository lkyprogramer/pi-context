import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { domainHash } from "../../../contracts/src/index.js";
import { opsError, sha256Bytes } from "./backup.js";

export interface GcPlan {
  workspaceRoot: string;
  candidates: string[];
  inventoryHash: string;
  confirmationToken: string;
}

export interface GcReceipt {
  removed: string[];
  dryRun: boolean;
}

function listBlobIds(workspaceRoot: string): string[] {
  const root = join(workspaceRoot, "blobs");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".bin")) out.push(entry.name.replace(/\.bin$/, ""));
    }
  };
  walk(root);
  return out.sort((left, right) => left.localeCompare(right));
}

function blobPath(workspaceRoot: string, blobId: string): string {
  const shard = blobId.replace(/^blob_/, "").slice(0, 2) || "00";
  return join(workspaceRoot, "blobs", "sha256", shard, `${blobId}.bin`);
}

export async function planWorkspaceGc(workspaceRoot: string, referenced: Iterable<string>): Promise<GcPlan> {
  const keep = new Set(referenced);
  const candidates = listBlobIds(workspaceRoot).filter((blobId) => !keep.has(blobId));
  const inventoryHash = domainHash("gc-inventory", { candidates, referenced: [...keep].sort() });
  return {
    workspaceRoot,
    candidates,
    inventoryHash,
    confirmationToken: sha256Bytes(Buffer.from(inventoryHash, "utf8")),
  };
}

export async function commitWorkspaceGc(plan: GcPlan, confirmationToken: string): Promise<GcReceipt> {
  if (confirmationToken !== plan.confirmationToken) throw opsError("PCR_GC_TOKEN_MISMATCH");
  const fresh = await planWorkspaceGc(plan.workspaceRoot, listBlobIds(plan.workspaceRoot).filter((id) => !plan.candidates.includes(id)));
  if (fresh.inventoryHash !== plan.inventoryHash) throw opsError("PCR_GC_INVENTORY_CHANGED");
  const removed: string[] = [];
  for (const blobId of plan.candidates) {
    const path = blobPath(plan.workspaceRoot, blobId);
    if (existsSync(path)) {
      unlinkSync(path);
      removed.push(blobId);
    }
  }
  return { removed, dryRun: false };
}

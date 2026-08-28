import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decryptAesGcm, encryptAesGcm } from "../crypto.js";
import { TestKeyProvider } from "../key-provider.js";
import { EncryptedBlobStore } from "../blob-store.js";
import { opsError, sha256Bytes } from "./backup.js";

export interface RotationInput {
  workspaceRoot: string;
  workspaceId: string;
  oldKey: Buffer;
  newKey: Buffer;
  crashAfter?: number;
}

export interface RotationState {
  phase: "dual" | "new";
  remaining: string[];
  done: string[];
  oldKeyHash: string;
  newKeyHash: string;
}

export interface RotationReceipt {
  phase: "dual" | "new";
  remaining: number;
  done: number;
  readableWith: Array<"old" | "new">;
}

function statePath(workspaceRoot: string): string {
  return join(workspaceRoot, "keys", "rotation.json");
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

function keyHash(key: Buffer): string {
  return sha256Bytes(key);
}

function readState(workspaceRoot: string): RotationState | null {
  const path = statePath(workspaceRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RotationState;
}

function writeState(workspaceRoot: string, state: RotationState): void {
  const path = statePath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function decryptWithRing(raw: Buffer, blobId: string, workspaceId: string, oldKey: Buffer, newKey: Buffer): { plain: Buffer; used: "old" | "new" } {
  try {
    return { plain: decryptAesGcm(raw, newKey, blobId, workspaceId), used: "new" };
  } catch {
    return { plain: decryptAesGcm(raw, oldKey, blobId, workspaceId), used: "old" };
  }
}

export async function rotateWorkspaceKeys(input: RotationInput): Promise<RotationReceipt> {
  const oldKeyHash = keyHash(input.oldKey);
  const newKeyHash = keyHash(input.newKey);
  const existing = readState(input.workspaceRoot);
  const all = listBlobIds(input.workspaceRoot);
  const remaining = existing?.remaining ?? all.filter((id) => !(existing?.done ?? []).includes(id));
  const done = existing?.done ?? [];
  const state: RotationState = {
    phase: remaining.length === 0 ? "new" : "dual",
    remaining: [...remaining],
    done: [...done],
    oldKeyHash,
    newKeyHash,
  };
  writeState(input.workspaceRoot, state);

  let rotated = 0;
  while (state.remaining.length > 0) {
    const blobId = state.remaining[0]!;
    const path = blobPath(input.workspaceRoot, blobId);
    const raw = readFileSync(path);
    const { plain } = decryptWithRing(raw, blobId, input.workspaceId, input.oldKey, input.newKey);
    const next = encryptAesGcm(plain, input.newKey, blobId, input.workspaceId);
    writeFileSync(path, next, { mode: 0o600 });
    state.remaining.shift();
    state.done.push(blobId);
    rotated += 1;
    state.phase = state.remaining.length === 0 ? "new" : "dual";
    writeState(input.workspaceRoot, state);
    if (input.crashAfter !== undefined && rotated >= input.crashAfter) {
      throw opsError("PCR_ROTATION_CRASH");
    }
  }

  const newStore = new EncryptedBlobStore({
    root: input.workspaceRoot,
    workspaceId: input.workspaceId,
    keys: new TestKeyProvider(input.newKey),
  });
  for (const blobId of state.done) {
    await newStore.read(blobId);
  }
  return {
    phase: "new",
    remaining: 0,
    done: state.done.length,
    readableWith: ["new"],
  };
}

export function readRotationState(workspaceRoot: string): RotationState | null {
  return readState(workspaceRoot);
}

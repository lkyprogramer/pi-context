import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BlobRef, RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import {
  BlobStoreError,
  MAX_ENCRYPTED_JSON_BLOB_BYTES,
  createEncryptedBlobStore,
  openWorkspaceSqliteStore,
  type WorkspaceBlobKeyProvider,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pcr-storage-node-t10-"));
  roots.push(root);
  return root;
}

function cursor(root: string, suffix = "a"): RuntimeCursor {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId: `session-${suffix}`,
    leafId: `leaf-${suffix}`,
    lineageEntryIds: ["entry-root", `leaf-${suffix}`],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function provider(keys: Record<string, Uint8Array>, currentKeyId = Object.keys(keys)[0]!): WorkspaceBlobKeyProvider {
  return {
    async current() { return { keyId: currentKeyId, key: keys[currentKeyId]! }; },
    async get(_workspaceId, keyId) { return keys[keyId] ?? null; },
  };
}

function blobPath(root: string, scope: RuntimeCursor, ref: BlobRef): string {
  const hash = ref.slice("blob_".length);
  return join(root, scope.workspaceId, "blobs", "sha256", hash.slice(0, 2), `${ref}.bin`);
}

function createStore(root: string, scope: RuntimeCursor, keys?: WorkspaceBlobKeyProvider) {
  return createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: scope.workspaceId,
    maxBlobBytes: 1024 * 1024,
    keys: keys ?? provider({ key1: Buffer.alloc(32, 1) }),
  });
}

async function waitForFiles(paths: string[]): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (paths.every((path) => existsSync(path))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child processes did not reach the publication barrier");
}

function runChild(script: string, payload: string, ready: string, gate: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.cwd(), "node_modules", ".bin", "jiti"), [script, payload, ready, gate], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`child exited ${code}: ${stderr}`));
    });
  });
}

describe("encrypted content-addressed blob store", () => {
  it("publishes encrypted bytes durably with deterministic cursor-scoped references", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const store = createStore(root, scope);
    const plain = Buffer.from("secret tool output\0\xff", "utf8");

    const first = await store.put(scope, plain);
    const second = await store.put(scope, plain);

    expect(first).toBe(second);
    expect(first).toMatch(/^blob_[a-f0-9]{64}$/u);
    expect(await store.read(scope, first)).toEqual(plain);
    const persisted = readFileSync(blobPath(root, scope, first));
    expect(persisted.includes(plain)).toBe(false);
    expect(statSync(blobPath(root, scope, first)).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, scope.workspaceId, "blobs")).mode & 0o777).toBe(0o700);
  });

  it("binds references and reads to the complete cursor before requesting a key", async () => {
    const root = dataRoot();
    const scope = cursor(root, "source");
    let getCalls = 0;
    const keys: WorkspaceBlobKeyProvider = {
      async current() { return { keyId: "key1", key: Buffer.alloc(32, 1) }; },
      async get() { getCalls += 1; return Buffer.alloc(32, 1); },
    };
    const store = createStore(root, scope, keys);
    const ref = await store.put(scope, Buffer.from("scoped"));
    const wrongSession = cursor(root, "other-session");
    const wrongModel = { ...scope, modelKey: "openclaw/other-model" };

    await expect(store.read(wrongSession, ref)).rejects.toMatchObject({ code: "PCR_BLOB_SCOPE_MISMATCH" });
    await expect(store.read(wrongModel, ref)).rejects.toMatchObject({ code: "PCR_BLOB_SCOPE_MISMATCH" });
    expect(getCalls).toBe(0);

    const otherRoot = dataRoot();
    await expect(store.read(cursor(otherRoot), ref)).rejects.toMatchObject({ code: "PCR_BLOB_WORKSPACE_MISMATCH" });
  });

  it("returns exact authenticated byte ranges including empty and binary ranges", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const store = createStore(root, scope);
    const plain = Uint8Array.from([0, 255, 1, 128, 2]);
    const ref = await store.put(scope, plain);
    const empty = await store.put(scope, new Uint8Array());

    expect(Array.from(await store.read(scope, ref, { start: 1, endExclusive: 4 }))).toEqual([255, 1, 128]);
    expect(Array.from(await store.read(scope, ref, { start: 5, endExclusive: 5 }))).toEqual([]);
    expect(Array.from(await store.read(scope, empty))).toEqual([]);
    await expect(store.read(scope, ref, { start: 4, endExclusive: 6 })).rejects.toMatchObject({
      code: "PCR_BLOB_RANGE_INVALID",
    });
    await expect(store.read(scope, ref, { start: -1, endExclusive: 1 })).rejects.toMatchObject({
      code: "PCR_BLOB_RANGE_INVALID",
    });
  });

  it("snapshots an authenticated range before awaiting the read key", async () => {
    const root = dataRoot();
    const scope = cursor(root, "range-mutation");
    const key = Buffer.alloc(32, 8);
    let blockReads = false;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = createStore(root, scope, {
      async current() { return { keyId: "key-range", key }; },
      async get(_workspaceId, keyId) {
        if (blockReads) {
          markStarted();
          await gate;
        }
        return keyId === "key-range" ? key : null;
      },
    });
    const ref = await store.put(scope, Buffer.from("0123456789"));
    blockReads = true;
    const range = { start: 2, endExclusive: 5 };
    const reading = store.read(scope, ref, range);
    await started;
    range.start = 7;
    range.endExclusive = 10;
    release();

    expect(await reading).toEqual(Buffer.from("234"));
  });

  it("round-trips a branded blob ref through SQLite before exact range read", async () => {
    const root = dataRoot();
    const scope = cursor(root, "sqlite-roundtrip");
    const blobs = createStore(root, scope);
    const ref = await blobs.put(scope, Buffer.from("persisted exact bytes"));
    const repository = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      busyTimeoutMs: 1_000,
    });
    await repository.put({
      evidenceId: "evidence_blob_roundtrip",
      cursor: scope,
      operationId: "operation_blob_roundtrip",
      observationId: "observation_blob_roundtrip",
      rawBlobId: ref,
      reducer: { id: "exact", revision: "v1" },
      kind: "tool-output",
      value: { bytes: 21 },
      sourceClass: "trusted-tool",
      authority: "inform",
      sourceRefs: ["tool-call-roundtrip"],
      validity: { kind: "observed", at: 1 },
      contentHash: "a".repeat(64),
      observedAt: 1,
    });
    await repository.close();

    const reopened = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      busyTimeoutMs: 1_000,
    });
    try {
      const durable = await reopened.get(scope, "evidence_blob_roundtrip");
      expect(durable).not.toBeNull();
      expect(await blobs.read(scope, durable!.rawBlobId, { start: 10, endExclusive: 15 })).toEqual(Buffer.from("exact"));
    } finally {
      await reopened.close();
    }
  });

  it("rejects ciphertext, tag, header and existing-object tampering without overwrite", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const store = createStore(root, scope);
    const plain = Buffer.from("tamper target");
    const ref = await store.put(scope, plain);
    const path = blobPath(root, scope, ref);
    const original = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const ciphertext = Buffer.from(original.ciphertext as string, "base64");
    ciphertext[0] = ciphertext[0]! ^ 0x01;
    writeFileSync(path, JSON.stringify({ ...original, ciphertext: ciphertext.toString("base64") }), { mode: 0o600 });

    await expect(store.read(scope, ref)).rejects.toMatchObject({ code: "PCR_BLOB_AUTH_FAILED" });
    await expect(store.put(scope, plain)).rejects.toBeInstanceOf(BlobStoreError);

    writeFileSync(path, JSON.stringify({ ...original, workspaceId: `ws_${"f".repeat(40)}` }), { mode: 0o600 });
    await expect(store.read(scope, ref)).rejects.toMatchObject({ code: "PCR_BLOB_SCOPE_MISMATCH" });

    writeFileSync(path, JSON.stringify({ ...original, blobId: `blob_${"f".repeat(64)}` }), { mode: 0o600 });
    await expect(store.read(scope, ref)).rejects.toMatchObject({ code: "PCR_BLOB_TAMPERED" });
  });

  it("fails closed for missing rotation keys and keeps deterministic references across a key change", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const allKeys = { key1: Buffer.alloc(32, 1), key2: Buffer.alloc(32, 2) };
    let currentKeyId = "key1";
    const keys: WorkspaceBlobKeyProvider = {
      async current() { return { keyId: currentKeyId, key: allKeys[currentKeyId as keyof typeof allKeys] }; },
      async get(_workspaceId, keyId) { return allKeys[keyId as keyof typeof allKeys] ?? null; },
    };
    const store = createStore(root, scope, keys);
    const ref = await store.put(scope, Buffer.from("same bytes"));
    currentKeyId = "key2";
    expect(await store.put(scope, Buffer.from("same bytes"))).toBe(ref);
    expect(await store.read(scope, ref)).toEqual(Buffer.from("same bytes"));

    const path = blobPath(root, scope, ref);
    const original = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...original, keyId: "retired-key" }), { mode: 0o600 });
    await expect(store.read(scope, ref)).rejects.toMatchObject({ code: "PCR_BLOB_KEY_UNAVAILABLE" });
  });

  it("settles concurrent same-content writes on one complete authenticated object", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const store = createStore(root, scope);
    const peer = createStore(root, scope);
    const plain = Buffer.alloc(64 * 1024, 7);
    const refs = await Promise.all(Array.from(
      { length: 12 },
      (_, index) => (index % 2 === 0 ? store : peer).put(scope, plain),
    ));

    expect(new Set(refs).size).toBe(1);
    expect(await store.read(scope, refs[0]!)).toEqual(plain);
    const directory = join(root, scope.workspaceId, "blobs", "sha256", refs[0]!.slice(5, 7));
    expect(readdirSync(directory)).toEqual([`${refs[0]}.bin`]);
  });

  it("makes the existing-object fast path durable across independent processes", async () => {
    const root = dataRoot();
    const scope = cursor(root, "multiprocess");
    const script = join(root, "put.ts");
    const payload = join(root, "payload.json");
    const gate = join(root, "publish.gate");
    const readyA = join(root, "ready-a");
    const readyB = join(root, "ready-b");
    const storageEntry = join(process.cwd(), "packages", "storage-node", "src", "index.ts");
    writeFileSync(payload, JSON.stringify({ root, scope }));
    writeFileSync(script, `
      import { existsSync, readFileSync, writeFileSync } from "node:fs";
      import { createEncryptedBlobStore } from ${JSON.stringify(storageEntry)};
      const [payloadPath, readyPath, gatePath] = process.argv.slice(2);
      const { root, scope } = JSON.parse(readFileSync(payloadPath, "utf8"));
      const key = Buffer.alloc(32, 9);
      const store = createEncryptedBlobStore({
        dataRoot: root,
        workspaceId: scope.workspaceId,
        maxBlobBytes: 1024 * 1024,
        keys: {
          async current() { return { keyId: "multiprocess", key }; },
          async get(_workspaceId, keyId) { return keyId === "multiprocess" ? key : null; },
        },
      });
      writeFileSync(readyPath, "ready");
      while (!existsSync(gatePath)) await new Promise((resolve) => setTimeout(resolve, 5));
      process.stdout.write(await store.put(scope, Buffer.from("cross-process durable")));
    `);

    const childA = runChild(script, payload, readyA, gate);
    const childB = runChild(script, payload, readyB, gate);
    await waitForFiles([readyA, readyB]);
    writeFileSync(gate, "publish");
    const refs = await Promise.all([childA, childB]);

    expect(refs[0]).toBe(refs[1]);
    const store = createStore(root, scope, provider({ multiprocess: Buffer.alloc(32, 9) }, "multiprocess"));
    expect(await store.read(scope, refs[0] as BlobRef)).toEqual(Buffer.from("cross-process durable"));
  });

  it("takes over a directory chain after its creator dies before parent fsync", async () => {
    const root = dataRoot();
    const scope = cursor(root, "directory-takeover");
    const workspaceRoot = join(root, scope.workspaceId);
    const blobsRoot = join(workspaceRoot, "blobs");
    const casRoot = join(blobsRoot, "sha256");
    const creator = spawnSync(process.execPath, [
      "-e",
      "require('node:fs').mkdirSync(process.argv[1], { recursive: true, mode: 0o700 }); process.kill(process.pid, 'SIGKILL');",
      casRoot,
    ]);
    expect(creator.signal).toBe("SIGKILL");

    const store = createStore(root, scope);
    const ref = await store.put(scope, Buffer.from("survivor publication"));

    expect(await store.read(scope, ref)).toEqual(Buffer.from("survivor publication"));
    expect(statSync(workspaceRoot).mode & 0o777).toBe(0o700);
    expect(statSync(blobsRoot).mode & 0o777).toBe(0o700);
    expect(statSync(casRoot).mode & 0o777).toBe(0o700);
  });

  it("snapshots the complete cursor before awaiting a key provider", async () => {
    const root = dataRoot();
    const mutable = cursor(root, "mutable");
    const original = { ...mutable };
    const key = Buffer.alloc(32, 6);
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = createStore(root, mutable, {
      async current() {
        markStarted();
        await gate;
        return { keyId: "key-mutable", key };
      },
      async get(_workspaceId, keyId) { return keyId === "key-mutable" ? key : null; },
    });

    const writing = store.put(mutable, Buffer.from("stable identity"));
    await started;
    mutable.modelKey = "openclaw/mutated-after-admission";
    mutable.lineageHash = "f".repeat(64);
    release();
    const ref = await writing;

    expect(await store.read(original, ref)).toEqual(Buffer.from("stable identity"));
    await expect(store.read(mutable, ref)).rejects.toMatchObject({ code: "PCR_BLOB_SCOPE_MISMATCH" });
  });

  it("ignores a crash-orphan spool and reopens only the final fsynced object", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    const store = createStore(root, scope);
    const ref = await store.put(scope, Buffer.from("durable"));
    const directory = join(root, scope.workspaceId, "blobs", "sha256", ref.slice(5, 7));
    writeFileSync(join(directory, ".interrupted.spool"), "partial", { mode: 0o600 });

    const reopened = createStore(root, scope);
    expect(await reopened.read(scope, ref)).toEqual(Buffer.from("durable"));
  });

  it("validates production dependencies, size limits and provider cancellation", async () => {
    const root = dataRoot();
    const scope = cursor(root);
    expect(() => createEncryptedBlobStore({
      dataRoot: "relative",
      workspaceId: scope.workspaceId,
      maxBlobBytes: 1,
      keys: provider({ key1: Buffer.alloc(32) }),
    })).toThrowError(expect.objectContaining({ code: "PCR_BLOB_INPUT_INVALID" }));
    expect(() => createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      maxBlobBytes: 1,
    } as never)).toThrowError(expect.objectContaining({ code: "PCR_BLOB_INPUT_INVALID" }));
    expect(() => createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      maxBlobBytes: MAX_ENCRYPTED_JSON_BLOB_BYTES + 1,
      keys: provider({ key1: Buffer.alloc(32) }),
    })).toThrowError(expect.objectContaining({ code: "PCR_BLOB_INPUT_INVALID" }));
    expect(() => createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      maxBlobBytes: MAX_ENCRYPTED_JSON_BLOB_BYTES,
      keys: provider({ key1: Buffer.alloc(32) }),
    })).not.toThrow();

    const bounded = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: scope.workspaceId,
      maxBlobBytes: 3,
      keys: provider({ key1: Buffer.alloc(32) }),
    });
    await expect(bounded.put(scope, Buffer.from("four"))).rejects.toMatchObject({ code: "PCR_BLOB_TOO_LARGE" });

    const cancelled = new DOMException("cancelled", "AbortError");
    const cancelling = createStore(root, scope, {
      async current() { throw cancelled; },
      async get() { return Buffer.alloc(32); },
    });
    await expect(cancelling.put(scope, Buffer.from("x"))).rejects.toBe(cancelled);
  });
});

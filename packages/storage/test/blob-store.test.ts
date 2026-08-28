import { readFileSync, statSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestBlobStore } from "./support.js";

describe("EncryptedBlobStore", () => {
  it("deduplicates identity while using authenticated randomized ciphertext", async () => {
    const key = Buffer.alloc(32, 7);
    const store = await createTestBlobStore({ key });
    const other = await createTestBlobStore({ key });
    const a = await store.put(Buffer.from("full tool output"));
    const b = await store.put(Buffer.from("full tool output"));
    const c = await other.put(Buffer.from("full tool output"));
    expect(a.blobId).toBe(b.blobId);
    expect(c.blobId).toBe(a.blobId);
    expect(await store.read(a.blobId)).toEqual(Buffer.from("full tool output"));
    expect(readFileSync(store.pathOf(a.blobId)).equals(readFileSync(other.pathOf(c.blobId)))).toBe(false);
    await expect(store.read("blob_" + "0".repeat(64))).rejects.toMatchObject({ code: "PCR_BLOB_NOT_FOUND" });
    await store.verify(a.blobId, Buffer.from("full tool output"));
  });

  it("fails authentication after a ciphertext bit flip", async () => {
    const store = await createTestBlobStore();
    const { blobId } = await store.put(Buffer.from("full tool output"));
    const path = store.pathOf(blobId);
    const envelope = JSON.parse(readFileSync(path, "utf8")) as { ciphertext: string };
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString("base64");
    writeFileSync(path, JSON.stringify(envelope));
    await expect(store.read(blobId)).rejects.toMatchObject({ code: "PCR_BLOB_AUTH_FAILED" });
  });

  it("blocks ready when the workspace key is unavailable", async () => {
    const store = await createTestBlobStore({ key: null });
    await expect(store.ready()).rejects.toMatchObject({ code: "PCR_KEY_UNAVAILABLE" });
    await expect(store.put(Buffer.from("x"))).rejects.toMatchObject({ code: "PCR_KEY_UNAVAILABLE" });
  });

  it("writes blob files with 0600 permissions on POSIX", async () => {
    const store = await createTestBlobStore();
    const { blobId } = await store.put(Buffer.from("full tool output"));
    expect(statSync(store.pathOf(blobId)).mode & 0o777).toBe(0o600);
  });

  it("never deletes a referenced blob during GC", async () => {
    const store = await createTestBlobStore();
    const kept = await store.put(Buffer.from("keep me"));
    const gone = await store.put(Buffer.from("delete me"));
    const removed = await store.gcCandidate([kept.blobId]);
    expect(removed).toEqual([gone.blobId]);
    expect(await store.read(kept.blobId)).toEqual(Buffer.from("keep me"));
    await expect(store.read(gone.blobId)).rejects.toMatchObject({ code: "PCR_BLOB_NOT_FOUND" });
  });
});

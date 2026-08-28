import { describe, expect, it } from "vitest";
import { readEvidenceById, type ExactReadDeps, type ExactReadRequest } from "../src/retrieval/exact-read.js";

function fakeReadDeps(input: {
  evidenceWorkspace: string;
  callerWorkspace: string;
  bytes?: Uint8Array;
  missingBlob?: boolean;
}): ExactReadDeps & { request: ExactReadRequest } {
  const bytes = input.bytes ?? Buffer.from("hello");
  return {
    request: { cursor: { workspaceId: input.callerWorkspace }, maxBytes: 1024 },
    store: {
      async getEvidence(id) {
        return {
          workspaceId: input.evidenceWorkspace,
          contentHash: "a".repeat(64),
          rawBlobId: `blob_${id}`,
        };
      },
    },
    blobs: {
      async read() {
        if (input.missingBlob) throw Object.assign(new Error("missing"), { code: "PCR_BLOB_NOT_FOUND" });
        return bytes;
      },
      async verify() {},
    },
  };
}

describe("exact evidence read", () => {
  it("denies a cross-workspace evidence ID even when the blob exists", async () => {
    const deps = fakeReadDeps({ evidenceWorkspace: "w-a", callerWorkspace: "w-b" });
    await expect(readEvidenceById("ev_aaaaaaaa", deps.request, deps)).rejects.toMatchObject({
      code: "PCR_RETRIEVAL_SCOPE_DENIED",
    });
  });

  it("rejects an invalid range", async () => {
    const deps = fakeReadDeps({ evidenceWorkspace: "w-a", callerWorkspace: "w-a" });
    await expect(readEvidenceById("ev_aaaaaaaa", { ...deps.request, range: { start: 4, end: 1 } }, deps)).rejects.toMatchObject({
      code: "PCR_INVALID_RANGE",
    });
  });

  it("cuts a UTF-8 boundary safely", async () => {
    const deps = fakeReadDeps({ evidenceWorkspace: "w-a", callerWorkspace: "w-a", bytes: Buffer.from("你") });
    const result = await readEvidenceById("ev_aaaaaaaa", { ...deps.request, range: { start: 1, end: 3 } }, deps);
    expect(result.bytes.includes(0x80) && result.bytes[0] === 0x80).toBe(false);
    expect(Buffer.from(result.bytes).toString("utf8")).not.toContain("\uFFFD");
  });

  it("redacts secrets before model output", async () => {
    const deps = fakeReadDeps({
      evidenceWorkspace: "w-a",
      callerWorkspace: "w-a",
      bytes: Buffer.from("api_key=secret-value"),
    });
    const result = await readEvidenceById("ev_aaaaaaaa", deps.request, deps);
    expect(result.bytes.toString()).toBe("[redacted]");
    expect(result.receipt.redacted).toBe(true);
  });

  it("reports pointer-unavailable when the blob is gone", async () => {
    const deps = fakeReadDeps({ evidenceWorkspace: "w-a", callerWorkspace: "w-a", missingBlob: true });
    await expect(readEvidenceById("ev_aaaaaaaa", deps.request, deps)).rejects.toMatchObject({
      code: "PCR_POINTER_UNAVAILABLE",
    });
  });
});

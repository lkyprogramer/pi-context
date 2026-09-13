import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { sha256Hex, utf8Bytes, type NativeEntry } from "../../src/contracts.js";
import { HistoryIndex } from "../../src/history/index.js";
import { parseObsRef, readObservation, REDUCER_RECEIPT_PREFIX } from "../../src/history/sol-pi.js";
import { createPlugin, historyTool, indexBranch } from "../../src/plugin.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

const SESSION = "sess-op1";
const OBS_ID = "obs_aaaaaaaaaaaaaaaaaaaaaaaa";
const UNIQUE_LINE = "UNIQUE_REDUCER_LINE_should_be_searchable";
const OUTSIDE_SECRET = "OUTSIDE_SECRET_must_not_be_indexed";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function writeObservation(sessionDir: string, text: string, hash = sha256Hex(utf8Bytes(text))): string {
  const root = join(sessionDir, "sol-pi", SESSION, "observation-pack");
  mkdirSync(join(root, "objects"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "objects", `${OBS_ID}.txt`), text, { mode: 0o600 });
  writeFileSync(
    join(root, "ledger.jsonl"),
    `${JSON.stringify({ event: "full", id: OBS_ID, contentHash: hash })}\n`,
    { mode: 0o600 },
  );
  return hash;
}

function writeReducerArchive(sessionDir: string, body: string): { path: string; hash: string } {
  const hash = sha256Hex(utf8Bytes(body));
  const dir = join(sessionDir, "sol-pi", SESSION, "evidence-preserving-reducer", "objects", hash.slice(0, 2));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${hash}.txt`);
  writeFileSync(path, body, { mode: 0o600 });
  return { path, hash };
}

function receiptText(archive: { path: string; hash: string }, extra = ""): string {
  return [
    REDUCER_RECEIPT_PREFIX,
    "status=failure",
    "uncertain=false",
    `source_sha256=${archive.hash}`,
    "source_bytes=80",
    "source_lines=4",
    `source_artifact=${archive.path}`,
    "verified_evidence:",
    "- none",
    extra,
  ].join("\n");
}

function receiptBranch(receipt: string, leaf = "22cc33dd"): NativeEntry[] {
  return [
    userEntry("00aa11bb", null, textBlocks("run tests")),
    assistantEntry("11bb22cc", "00aa11bb", [{ type: "toolCall", id: "c1", name: "bash" }], "toolUse"),
    toolResultEntry("3f9a2c1e", "11bb22cc", "c1", textBlocks(receipt)),
    assistantEntry(leaf, "3f9a2c1e", textBlocks("done")),
  ];
}

describe("SoL-Pi observation pack read", () => {
  it("parses obs ids and rejects lookalikes", () => {
    expect(parseObsRef(OBS_ID)).toBe(OBS_ID);
    expect(parseObsRef(` ${OBS_ID} `)).toBe(OBS_ID);
    expect(parseObsRef("obs_aaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(parseObsRef("obs_AAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(parseObsRef("3f9a2c1e")).toBeNull();
    expect(parseObsRef("pctx:6:eyJ2Ijo2fQ")).toBeNull();
  });

  it("reads a ledger-verified object and pages with a pctx cursor, not a 16 KiB OP page", async () => {
    const sessionDir = tmp("pctx-op-");
    const body = `${"line\n".repeat(40)}TARGET_BYTE_PAGE\n${"tail\n".repeat(20)}`;
    const hash = writeObservation(sessionDir, body);
    const state = createPlugin();
    state.sessionDir = sessionDir;
    const first = await historyTool(state, { action: "read", ref: OBS_ID }, [], "/tmp/pctx-op", SESSION, "leaf");
    expect(first.code).toBe("ok");
    expect(first.verified).toBe(true);
    expect(first.sourceHash).toBe(hash);
    expect(first.page).toContain("line");
    expect(first.details).toMatchObject({ kind: "observation-pack", id: OBS_ID });

    const paged = readObservation({
      sessionDir,
      sessionId: SESSION,
      obsId: OBS_ID,
      budget: { maxTokens: 8, maxBytes: 24, estimateKind: "character-estimate" },
      config: DEFAULT_CONFIG,
    });
    expect(paged.code).toBe("ok");
    expect((paged.page ?? "").length).toBeGreaterThan(0);
    expect(paged.nextCursor).toBeTruthy();
    expect(Buffer.byteLength(paged.page ?? "", "utf8")).toBeLessThanOrEqual(24);
    const rest = readObservation({
      sessionDir,
      sessionId: SESSION,
      obsId: OBS_ID,
      cursor: paged.nextCursor,
      budget: { maxTokens: 4000, maxBytes: 32_768, estimateKind: "character-estimate" },
      config: DEFAULT_CONFIG,
    });
    expect(rest.code).toBe("ok");
    expect(`${paged.page}${rest.page}`).toBe(body);
  });

  it("refuses a missing ledger hash, a hash mismatch, and a missing session dir", async () => {
    const sessionDir = tmp("pctx-op-bad-");
    writeObservation(sessionDir, "payload-a", "0".repeat(64));
    const state = createPlugin();
    state.sessionDir = sessionDir;
    const mismatch = await historyTool(state, { action: "read", ref: OBS_ID }, [], "/tmp/pctx-op", SESSION, "leaf");
    expect(mismatch.code).toBe("source-changed");

    const missing = createPlugin();
    missing.sessionDir = sessionDir;
    const miss = await historyTool(
      missing,
      { action: "read", ref: "obs_bbbbbbbbbbbbbbbbbbbbbbbb" },
      [],
      "/tmp/pctx-op",
      SESSION,
      "leaf",
    );
    expect(miss.code).toBe("source-missing");

    const noDir = createPlugin();
    const degraded = await historyTool(noDir, { action: "read", ref: OBS_ID }, [], "/tmp/pctx-op", SESSION, "leaf");
    expect(degraded.code).toBe("source-missing");
    expect(degraded.diagnostic).toMatch(/persistent Pi session directory/);
  });
});

describe("SoL-Pi reducer receipt indexing", () => {
  it("indexes the source artifact without rewriting the receipt, and search finds the original line", async () => {
    const sessionDir = tmp("pctx-red-");
    const archive = writeReducerArchive(sessionDir, `build failed\n${UNIQUE_LINE}\nend\n`);
    const receipt = receiptText(archive);
    const entries = receiptBranch(receipt);
    const state = createPlugin();
    state.sessionDir = sessionDir;
    indexBranch(state, entries, "/tmp/pctx-red", SESSION, "22cc33dd");

    const search = await historyTool(
      state,
      { action: "search", query: UNIQUE_LINE },
      entries,
      "/tmp/pctx-red",
      SESSION,
      "22cc33dd",
    );
    expect(search.code).toBe("ok");
    expect(search.hits?.some((hit) => hit.entryId === "3f9a2c1e" && hit.excerpt.includes(UNIQUE_LINE))).toBe(true);

    const original = await historyTool(
      state,
      { action: "read", ref: "3f9a2c1e:1" },
      entries,
      "/tmp/pctx-red",
      SESSION,
      "22cc33dd",
    );
    expect(original.code).toBe("ok");
    expect(original.verified).toBe(true);
    expect(original.page).toContain(UNIQUE_LINE);
    expect(original.page).not.toContain(REDUCER_RECEIPT_PREFIX);

    const stub = await historyTool(
      state,
      { action: "read", ref: "3f9a2c1e" },
      entries,
      "/tmp/pctx-red",
      SESSION,
      "22cc33dd",
    );
    expect(stub.page).toBe(receipt);
  });

  it("does not index a source_artifact outside the session sol-pi root", async () => {
    const sessionDir = tmp("pctx-red-escape-");
    const outsideDir = tmp("pctx-outside-");
    const outsidePath = join(outsideDir, "passwd-like.txt");
    writeFileSync(outsidePath, OUTSIDE_SECRET);
    const hash = sha256Hex(utf8Bytes(OUTSIDE_SECRET));
    const receipt = receiptText({ path: outsidePath, hash });
    const entries = receiptBranch(receipt);
    const state = createPlugin();
    state.sessionDir = sessionDir;
    indexBranch(state, entries, "/tmp/pctx-red-escape", SESSION, "22cc33dd");
    const search = await historyTool(
      state,
      { action: "search", query: OUTSIDE_SECRET },
      entries,
      "/tmp/pctx-red-escape",
      SESSION,
      "22cc33dd",
    );
    expect(search.hits ?? []).toEqual([]);
    const read = await historyTool(
      state,
      { action: "read", ref: "3f9a2c1e:1" },
      entries,
      "/tmp/pctx-red-escape",
      SESSION,
      "22cc33dd",
    );
    expect(read.code).toBe("source-missing");
  });

  it("backfills the original log when the first index pass had no sessionDir", async () => {
    const sessionDir = tmp("pctx-red-backfill-");
    const archive = writeReducerArchive(sessionDir, `later\n${UNIQUE_LINE}\n`);
    const entries = receiptBranch(receiptText(archive));
    const state = createPlugin();
    indexBranch(state, entries, "/tmp/pctx-red-bf", SESSION, "22cc33dd");
    const before = await historyTool(
      state,
      { action: "search", query: UNIQUE_LINE },
      entries,
      "/tmp/pctx-red-bf",
      SESSION,
      "22cc33dd",
    );
    expect(before.hits ?? []).toEqual([]);
    state.sessionDir = sessionDir;
    indexBranch(state, entries, "/tmp/pctx-red-bf", SESSION, "22cc33dd");
    const after = await historyTool(
      state,
      { action: "search", query: UNIQUE_LINE },
      entries,
      "/tmp/pctx-red-bf",
      SESSION,
      "22cc33dd",
    );
    expect(after.hits?.some((hit) => hit.excerpt.includes(UNIQUE_LINE))).toBe(true);
  });

  it("keeps a sibling-branch receipt out of the current leaf search", async () => {
    const sessionDir = tmp("pctx-red-scope-");
    const archive = writeReducerArchive(sessionDir, UNIQUE_LINE);
    const receipt = receiptText(archive);
    const entries: NativeEntry[] = [
      userEntry("00aa11bb", null, textBlocks("q")),
      assistantEntry("11bb22cc", "00aa11bb", [{ type: "toolCall", id: "c1", name: "bash" }], "toolUse"),
      toolResultEntry("3f9a2c1e", "11bb22cc", "c1", textBlocks("visible ok")),
      assistantEntry("22cc33dd", "3f9a2c1e", textBlocks("done")),
      toolResultEntry("9e9e9e9e", "11bb22cc", "c2", textBlocks(receipt)),
    ];
    const state = createPlugin();
    state.sessionDir = sessionDir;
    const search = await historyTool(
      state,
      { action: "search", query: UNIQUE_LINE },
      entries,
      "/tmp/pctx-red-scope",
      SESSION,
      "22cc33dd",
    );
    expect(search.hits ?? []).toEqual([]);
  });
});

describe("HistoryIndex extra block does not break leaf no-op for ordinary entries", () => {
  it("same leaf without a receipt stays a no-op", () => {
    const idx = HistoryIndex.open({ mode: "memory-only", dbPath: null, maxIndexBytes: 1_000_000 });
    const entries = [toolResultEntry("e1", null, "c1", textBlocks("needle once"))];
    const scope = {
      workspaceId: "w",
      sessionId: SESSION,
      leafId: "e1",
      visibleEntryIds: new Set(["e1"]),
    };
    expect(idx.upsertBranchSync(scope, entries)).toBe(1);
    expect(idx.upsertBranchSync(scope, entries)).toBe(0);
  });
});

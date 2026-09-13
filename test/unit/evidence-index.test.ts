import { describe, expect, it } from "vitest";
import { utf8Bytes, type NativeEntry } from "../../src/contracts.js";
import { applyBeforeCompact, createPlugin, historyTool } from "../../src/plugin.js";
import {
  EVIDENCE_INDEX_BUDGET_BYTES,
  EVIDENCE_INDEX_HEADER,
  attachEvidenceIndex,
  buildEvidenceIndex,
} from "../../src/projection/evidence-index.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

const ok = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 };

function expose(entry: ReturnType<typeof assistantEntry>) {
  entry.message!.usage = ok;
  return entry;
}

function namedResult(id: string, parent: string, call: string, tool: string, text: string): NativeEntry {
  const entry = toolResultEntry(id, parent, call, textBlocks(text));
  entry.message!.toolName = tool;
  return entry;
}

function chain(results: Array<{ id: string; tool?: string; text: string }>): NativeEntry[] {
  const entries: NativeEntry[] = [userEntry("u", null, textBlocks("q"))];
  let parent = "u";
  results.forEach((row, i) => {
    const call = `c${i}`;
    const assist = `a${i}`;
    const done = `d${i}`;
    entries.push(assistantEntry(assist, parent, [{ type: "toolCall", id: call, name: row.tool ?? "bash" }], "toolUse"));
    entries.push(namedResult(row.id, assist, call, row.tool ?? "bash", row.text));
    entries.push(expose(assistantEntry(done, row.id, textBlocks("ok"))));
    parent = done;
  });
  return entries;
}

describe("buildEvidenceIndex", () => {
  it("writes a summary index for derived-exposed results, newest first", () => {
    const entries = chain([
      { id: "r1", text: "version=9.2.1 first dump" },
      { id: "r2", text: "later observation" },
    ]);
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
      exposed: new Set(["r1", "r2"]),
      leafId: entries.at(-1)!.id,
    });
    expect(index.text).toContain(EVIDENCE_INDEX_HEADER);
    expect(index.text).toMatch(/id=r2 tool=bash head=later observation bytes=\d+/);
    expect(index.text).toMatch(/id=r1 tool=bash head=version=9.2.1 first dump bytes=\d+/);
    expect(index.text.indexOf("id=r2")).toBeLessThan(index.text.indexOf("id=r1"));
    expect(index.bytes).toBeLessThanOrEqual(EVIDENCE_INDEX_BUDGET_BYTES);
  });

  it("stays under the 1.5 KB budget", () => {
    const results = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i.toString(16).padStart(8, "0")}`,
      text: `head-line-${i} ${"x".repeat(200)}`,
    }));
    const entries = chain(results);
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
      exposed: new Set(results.map((row) => row.id)),
      leafId: entries.at(-1)!.id,
    });
    expect(index.bytes).toBeLessThanOrEqual(EVIDENCE_INDEX_BUDGET_BYTES);
    expect(index.lines.length).toBeGreaterThan(0);
    expect(index.lines.length).toBeLessThan(40);
  });

  it("omits sibling-branch entries that would be REF_SCOPE", () => {
    const entries = chain([{ id: "r1", text: "on-path" }]);
    const sibling = namedResult("r-sib", "a0", "c-sib", "bash", "other-branch");
    sibling.parentId = "a0";
    entries.push(sibling, expose(assistantEntry("d-sib", "r-sib", textBlocks("ok"))));
    const visible = new Set(entries.filter((e) => e.id !== "r-sib" && e.id !== "d-sib").map((e) => e.id));
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: visible,
      exposed: new Set(["r1", "r-sib"]),
      leafId: "d0",
    });
    expect(index.text).toContain("id=r1");
    expect(index.text).not.toContain("r-sib");
  });

  it("omits entries already retrieved via pctx_history, except last update_plan", () => {
    const entries = chain([
      { id: "r1", text: "already read dump" },
      { id: "plan1", tool: "update_plan", text: '{"step":1}' },
    ]);
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
      exposed: new Set(["r1", "plan1"]),
      readEntryIds: new Set(["r1", "plan1"]),
      leafId: entries.at(-1)!.id,
    });
    expect(index.text).not.toContain("id=r1");
    expect(index.text).toContain("id=plan1");
    expect(index.text).toContain("tool=update_plan");
  });

  it("skips tool results that are not yet derived-exposed", () => {
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a1", "u", [{ type: "toolCall", id: "c1" }], "toolUse"),
      namedResult("pending", "a1", "c1", "bash", "not yet seen"),
    ];
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
      exposed: new Set(),
      leafId: "pending",
    });
    expect(index.text).toBe("");
    expect(index.lines).toEqual([]);
  });
});

describe("applyBeforeCompact", () => {
  it("appends the index to the compaction summary and keeps the cut point", () => {
    const entries = chain([{ id: "r1", text: "version=9.2.1 first dump" }]);
    const state = createPlugin();
    state.scope = {
      workspaceId: "w",
      sessionId: "s",
      leafId: entries.at(-1)!.id,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
    };
    const result = applyBeforeCompact(state, {
      preparation: { previousSummary: "Goal: keep going", firstKeptEntryId: "keep-me", tokensBefore: 9000 },
      branchEntries: entries,
    });
    expect(result?.compaction.firstKeptEntryId).toBe("keep-me");
    expect(result?.compaction.tokensBefore).toBe(9000);
    expect(result?.compaction.summary).toContain("Goal: keep going");
    expect(result?.compaction.summary).toContain("id=r1");
    expect(result?.compaction.details.pctxEvidenceIndex).toBe(true);
    expect(utf8Bytes(result!.compaction.summary).length).toBeGreaterThan(result!.compaction.details.bytes);
  });

  it("does not take over compact when the profile is off or there is no index", () => {
    const entries = chain([{ id: "r1", text: "x" }]);
    const off = createPlugin();
    off.profile = "off";
    expect(
      applyBeforeCompact(off, {
        preparation: { firstKeptEntryId: "keep", tokensBefore: 1 },
        branchEntries: entries,
      }),
    ).toBeUndefined();
    const empty = createPlugin();
    expect(
      applyBeforeCompact(empty, {
        preparation: { firstKeptEntryId: "keep", tokensBefore: 1 },
        branchEntries: [userEntry("u", null, textBlocks("only user"))],
      }),
    ).toBeUndefined();
  });

  it("records verified reads so a later compact index drops those entries", async () => {
    const entries = chain([{ id: "3f9a2c1e", text: "verbatim maven log line" }]);
    const state = createPlugin();
    const leaf = entries.at(-1)!.id;
    const result = await historyTool(state, { action: "read", ref: "3f9a2c1e" }, entries, "/tmp/pctx-evidence", "s", leaf);
    expect(result.verified).toBe(true);
    expect(state.historyReadEntryIds.has("3f9a2c1e")).toBe(true);
    const index = buildEvidenceIndex({
      entries,
      visibleEntryIds: new Set(entries.map((e) => e.id)),
      exposed: new Set(["3f9a2c1e"]),
      readEntryIds: state.historyReadEntryIds,
      leafId: leaf,
    });
    expect(index.text).toBe("");
  });
});

describe("attachEvidenceIndex", () => {
  it("joins previous summary and the index without inventing prose", () => {
    expect(attachEvidenceIndex("old", "<pctx-evidence>\nid=a tool=bash head=h bytes=1\n</pctx-evidence>")).toContain("old");
    expect(attachEvidenceIndex(undefined, "<pctx-evidence>\n</pctx-evidence>")).toBe("<pctx-evidence>\n</pctx-evidence>");
  });
});

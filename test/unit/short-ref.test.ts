import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import type { NativeEntry } from "../../src/contracts.js";
import { HistoryIndex } from "../../src/history/index.js";
import { parseShortRef, textSourceHash } from "../../src/history/refs.js";
import { createPlugin, historyTool } from "../../src/plugin.js";
import { collectBatches } from "../../src/projection/batches.js";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import { planFold, stubFor } from "../../src/projection/planner.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

const cwd = "/tmp/pctx-short-ref";
const TEXT = "verbatim maven log line that the model wants back";

function branch(): NativeEntry[] {
  // Pi entry ids are 8 hex chars; `3f9a2c1f` below is the one-character mistyping of `3f9a2c1e`.
  return [
    userEntry("00aa11bb", null, textBlocks("q")),
    assistantEntry("11bb22cc", "00aa11bb", [{ type: "toolCall", id: "c1", name: "bash" }], "toolUse"),
    toolResultEntry("3f9a2c1e", "11bb22cc", "c1", textBlocks(TEXT, "second block")),
    assistantEntry("22cc33dd", "3f9a2c1e", textBlocks("done")),
    // Sibling branch: same session, not an ancestor of the leaf.
    toolResultEntry("9e9e9e9e", "11bb22cc", "c1", textBlocks("other branch text")),
  ];
}

function plugin() {
  const state = createPlugin();
  state.index = HistoryIndex.unavailable();
  return state;
}

describe("pctx_history read accepts the short entryId form", () => {
  it("parses short refs and never mistakes a full ref for one", () => {
    expect(parseShortRef("3f9a2c1e")).toEqual({ entryId: "3f9a2c1e", blockIndex: 0 });
    expect(parseShortRef("3f9a2c1e:1")).toEqual({ entryId: "3f9a2c1e", blockIndex: 1 });
    expect(parseShortRef(" 3f9a2c1e ")).toEqual({ entryId: "3f9a2c1e", blockIndex: 0 });
    expect(parseShortRef("pctx:6:eyJ2Ijo2fQ")).toBeNull();
    expect(parseShortRef("pctx:6")).toBeNull();
    expect(parseShortRef("3F9A2C1E")).toBeNull();
    expect(parseShortRef("3f9a2c1")).toBeNull();
    expect(parseShortRef("r1")).toBeNull();
    expect(parseShortRef("")).toBeNull();
    expect(parseShortRef("a b")).toBeNull();
  });

  it("malformed full refs keep their previous diagnostics", async () => {
    const entries = branch();
    const state = plugin();
    const truncated = await historyTool(state, { action: "read", ref: "pctx:6" }, entries, cwd, "s", "22cc33dd");
    expect(truncated.code).toBe("denied");
    expect(truncated.diagnostic).toBe("REF_VERSION");
    const nonHex = await historyTool(state, { action: "read", ref: "r1" }, entries, cwd, "s", "22cc33dd");
    expect(nonHex.code).toBe("denied");
    expect(nonHex.diagnostic).toBe("REF_VERSION");
  });

  it("resolves the id inside the current scope and reads verified", async () => {
    const entries = branch();
    const state = plugin();
    const read = await historyTool(state, { action: "read", ref: "3f9a2c1e" }, entries, cwd, "s", "22cc33dd");
    expect(read.code).toBe("ok");
    expect(read.verified).toBe(true);
    expect(read.sourceHash).toBe(textSourceHash(TEXT));
    expect(read.page).toBe(TEXT);
    expect(state.verifiedReads).toBe(1);
    const second = await historyTool(state, { action: "read", ref: "3f9a2c1e:1" }, entries, cwd, "s", "22cc33dd");
    expect(second.code).toBe("ok");
    expect(second.page).toBe("second block");
    const range = await historyTool(state, { action: "read", ref: "3f9a2c1e:2" }, entries, cwd, "s", "22cc33dd");
    expect(range.code).toBe("denied");
    expect(range.diagnostic).toBe("REF_OUT_OF_RANGE");
  });

  it("denies a mistyped id, an unknown id, an ambiguous id and an id from another branch", async () => {
    const entries = branch();
    const state = plugin();
    const mistyped = await historyTool(state, { action: "read", ref: "3f9a2c1f" }, entries, cwd, "s", "22cc33dd");
    expect(mistyped.code).toBe("denied");
    expect(mistyped.diagnostic).toBe("REF_ENTRY");
    const unknown = await historyTool(state, { action: "read", ref: "deadbeef" }, entries, cwd, "s", "22cc33dd");
    expect(unknown.code).toBe("denied");
    expect(unknown.diagnostic).toBe("REF_ENTRY");
    const otherBranch = await historyTool(state, { action: "read", ref: "9e9e9e9e" }, entries, cwd, "s", "22cc33dd");
    expect(otherBranch.code).toBe("denied");
    expect(otherBranch.diagnostic).toBe("REF_SCOPE");
    const duplicated = [...entries, toolResultEntry("3f9a2c1e", "11bb22cc", "c1", textBlocks("dup"))];
    const ambiguous = await historyTool(state, { action: "read", ref: "3f9a2c1e" }, duplicated, cwd, "s", "22cc33dd");
    expect(ambiguous.code).toBe("denied");
    expect(ambiguous.diagnostic).toBe("REF_ENTRY");
    expect(state.verifiedReads).toBe(0);
  });

  it("fold stubs carry the short id next to the full ref", () => {
    const ok = { input: 10, totalTokens: 15 };
    const big = "x".repeat(6000);
    const entries: NativeEntry[] = [
      userEntry("u", null, textBlocks("q")),
      { id: "a1", parentId: "u", type: "message", message: { role: "assistant", stopReason: "toolUse", usage: ok, content: [{ type: "toolCall", id: "c1", name: "read" }] } },
      toolResultEntry("3f9a2c1e", "a1", "c1", textBlocks(big)),
      { id: "a2", parentId: "3f9a2c1e", type: "message", message: { role: "assistant", stopReason: "toolUse", usage: ok, content: [{ type: "toolCall", id: "c2", name: "read" }] } },
      toolResultEntry("r2", "a2", "c2", textBlocks(big)),
      { id: "a3", parentId: "r2", type: "message", message: { role: "assistant", stopReason: "stop", usage: ok, content: [{ type: "text", text: "done" }] } },
    ];
    const cfg = { ...DEFAULT_CONFIG, fold: { ...DEFAULT_CONFIG.fold, protectRecentBatches: 1, minRemovedTokens: 100 } };
    const plan = planFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "a3", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: exposedEntryIds(entries),
      usage: { tokens: 8000, contextWindow: 10_000, percent: 80 },
      previous: null,
      modelId: "m",
      cfg,
      configHash: "h",
    });
    const stub = plan?.replacements.get("3f9a2c1e:0")?.stub ?? "";
    expect(stub).toContain(" id=3f9a2c1e\n");
    expect(stub).toMatch(/^read: pctx_history\(action="read", ref="3f9a2c1e"\)  full ref: pctx:6:[A-Za-z0-9_-]+$/m);
    expect(stub.match(/ref=/g)).toHaveLength(1);
    const later = stubFor({
      toolName: "bash",
      callId: "c9",
      isError: false,
      bytes: 2048,
      sourceHash: "a".repeat(64),
      head: "first line",
      ref: "pctx:6:AAAA",
      entryId: "3f9a2c1e",
      blockIndex: 1,
    });
    expect(later).toContain("id=3f9a2c1e:1");
    expect(later).toContain('read: pctx_history(action="read", ref="3f9a2c1e:1")  full ref: pctx:6:AAAA');
  });
});

import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createEvidenceCatalog } from "@pcr/runtime";

const cursor = createRuntimeCursor({
  workspacePath: "/tmp/pcr-catalog",
  sessionId: "session-catalog",
  leafId: "leaf-catalog",
  lineageEntryIds: ["root", "leaf-catalog"],
  modelKey: "openclaw/Qwen3.8-27B-WORK",
});

describe("snapshot-scoped evidence catalog", () => {
  it("isolates concurrent tools, branch splits, and retired pointers", async () => {
    const catalog = createEvidenceCatalog();
    const [a, b] = await Promise.all([
      catalog.admit({ cursor, ref: "ev-a", kind: "note", sourceId: "src-1", authority: "inform", now: 1 }),
      catalog.admit({ cursor, ref: "ev-b", kind: "error", sourceId: "src-2", authority: "inform", now: 2 }),
    ]);
    expect(a.ref).not.toBe(b.ref);
    const branch = { ...cursor, lineageHash: "b".repeat(64), leafId: "leaf-b" };
    await catalog.admit({ cursor: branch, ref: "ev-branch", kind: "note", sourceId: "src-3", authority: "inform", now: 3 });
    expect(await catalog.list(cursor)).toHaveLength(2);
    expect(await catalog.list(branch)).toHaveLength(1);
    await catalog.retire(cursor, "ev-a");
    const active = await catalog.list(cursor);
    expect(active.map((item) => item.ref)).toEqual(["ev-b"]);
    const selected = await catalog.select(cursor, { first: "src-2", last: "src-2" });
    expect(selected.map((item) => item.ref)).toEqual(["ev-b"]);
  });
});

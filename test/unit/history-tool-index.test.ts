import { expect, it } from "vitest";
import { HistoryIndex } from "../../src/history/index.js";
import { buildScope } from "../../src/history/scope.js";
import { encodeRef, refForField } from "../../src/history/refs.js";
import { createPlugin, historyTool } from "../../src/plugin.js";
import { toolResultEntry, textBlocks } from "../../src/testing.js";

it("read still returns verified text when the index is unavailable", async () => {
  const text = "folded original that must remain readable";
  const entry = toolResultEntry("r1", null, "c1", textBlocks(text));
  const state = createPlugin();
  state.index = HistoryIndex.unavailable();
  const cwd = "/tmp/pctx-read";
  const getEntry = (id: string) => (id === "r1" ? entry : undefined);
  const scope = buildScope({ cwd, sessionId: "s", leafId: "r1", getEntry });
  const field = refForField(scope, entry, 0);
  if ("code" in field) throw new Error(field.code);
  const read = await historyTool(state, { action: "read", ref: encodeRef(field) }, [entry], cwd, "s", "r1");
  expect(read.code).toBe("ok");
  expect(read.verified).toBe(true);
  expect(read.page).toContain("folded original");
  expect(state.verifiedReads).toBe(1);

  const search = await historyTool(state, { action: "search", query: "original" }, [entry], cwd, "s", "r1");
  expect(search.code).toBe("degraded");
  expect(search.diagnostic).toMatch(/unavailable/);
});

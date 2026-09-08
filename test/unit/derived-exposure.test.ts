import { expect, it } from "vitest";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import { collectBatches, protectSet } from "../../src/projection/batches.js";
import type { NativeEntry } from "../../src/contracts.js";

const ok = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 };
const a = (id: string, parent: string | null, calls: string[], stop = "toolUse", usage = ok): NativeEntry =>
  ({ id, parentId: parent, type: "message", message: { role: "assistant", stopReason: stop, usage, content: calls.map((c) => ({ type: "toolCall", id: c, name: "bash", arguments: {} })) } });
const r = (id: string, parent: string, call: string, isError = false): NativeEntry =>
  ({ id, parentId: parent, type: "message", message: { role: "toolResult", toolCallId: call, toolName: "bash", isError, content: [{ type: "text", text: `out-${id}` }] } });

it("derives exposure only from a later successful assistant entry", () => {
  const entries = [
    a("a1", null, ["c1"]), r("r1", "a1", "c1"),
    a("a2", "r1", ["c2"]), r("r2", "a2", "c2"),
    a("a3", "r2", [], "error", { ...ok, totalTokens: 0, input: 0 }),
  ];
  const exposed = exposedEntryIds(entries);
  expect(exposed.has("r1")).toBe(true);
  expect(exposed.has("r2")).toBe(false);
});

it("protects error batches and the last K complete batches", () => {
  const entries: NativeEntry[] = [
    a("a1", null, ["c1"]), r("r1", "a1", "c1"),
    a("a2", "r1", ["c2"]), r("r2", "a2", "c2", true),
    a("a3", "r2", ["c3", "c4"]), r("r3", "a3", "c3"),
    a("a4", "r3", ["c5"]), r("r5", "a4", "c5"),
  ];
  const batches = collectBatches(entries);
  expect(batches.map((b) => b.complete)).toEqual([true, true, false, true]);
  const protect = protectSet(batches, 1);
  expect(protect.has("r5")).toBe(true);
  expect(protect.has("r2")).toBe(true);
  expect(protect.has("r3")).toBe(true);
  expect(protect.has("r1")).toBe(false);
});

it("does not expose a batch closed by aborted or missing usage", () => {
  const withAbort = [a("a1", null, ["c1"]), r("r1", "a1", "c1"), a("a2", "r1", [], "aborted")];
  expect(exposedEntryIds(withAbort).has("r1")).toBe(false);
  const noUsage: NativeEntry[] = [
    a("a1", null, ["c1"]),
    r("r1", "a1", "c1"),
    { id: "a2", parentId: "r1", type: "message", message: { role: "assistant", stopReason: "stop", content: [] } },
  ];
  expect(exposedEntryIds(noUsage).has("r1")).toBe(false);
});

it("text-only assistants still flush pending results; compaction entries are skipped", () => {
  const entries: NativeEntry[] = [
    a("a1", null, ["c1"]),
    r("r1", "a1", "c1"),
    { id: "cmp", parentId: "r1", type: "compaction", customType: "compaction" },
    { id: "a2", parentId: "cmp", type: "message", message: { role: "assistant", stopReason: "stop", usage: ok, content: [{ type: "text", text: "ok" }] } },
  ];
  expect(exposedEntryIds(entries).has("r1")).toBe(true);
  expect(collectBatches(entries)).toHaveLength(1);
});

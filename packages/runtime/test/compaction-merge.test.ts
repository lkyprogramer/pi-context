import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { mergeCompactionStates } from "@pcr/runtime";

const cursor = createRuntimeCursor({
  workspacePath: "/tmp/pcr-merge",
  sessionId: "session-merge",
  leafId: "leaf-merge",
  lineageEntryIds: ["root", "leaf-merge"],
  modelKey: "openclaw/Qwen3.8-27B-WORK",
});

function directive(id: string, key: string, value: string, status: "active" | "superseded" = "active") {
  return {
    directiveId: id,
    userTurnId: `turn-${id}`,
    exactQuote: `${key}=${value}`,
    quoteHash: "a".repeat(64),
    utf8ByteRange: { start: 0, end: 1 },
    utf16Range: { start: 0, end: 1 },
    codePointRange: { start: 0, end: 1 },
    kind: "constraint" as const,
    polarity: "must" as const,
    key,
    value,
    status,
  };
}

describe("recursive compaction state merge", () => {
  it("rebuilds hard directives from store history across three cycles", () => {
    const first = {
      cursor,
      directives: [directive("d1", "cache", "invalidate")],
      claims: [{ claimId: "c1", key: "cache", status: "active", value: "invalidate" }],
      taskFronts: { active: ["t1"], parked: [], completed: [], superseded: [] },
      sourceSpan: { first: "s1", last: "s1" },
    };
    const second = {
      cursor,
      directives: [directive("d1", "cache", "invalidate"), directive("d2", "version", "6")],
      claims: [{ claimId: "c2", key: "version", status: "active", value: "6" }],
      taskFronts: { active: ["t1"], parked: [], completed: [], superseded: [] },
      sourceSpan: { first: "s1", last: "s2" },
    };
    const third = {
      cursor,
      directives: [directive("d2", "version", "6", "superseded"), directive("d3", "version", "7")],
      claims: [{ claimId: "c3", key: "version", status: "active", value: "7" }],
      taskFronts: { active: ["t1"], parked: [], completed: [], superseded: [] },
      sourceSpan: { first: "s1", last: "s3" },
    };
    const merged = mergeCompactionStates([first, second, third]);
    expect(merged.directives.some((item) => item.key === "cache" && item.value === "invalidate")).toBe(true);
    expect(merged.directives.some((item) => item.key === "version" && item.value === "7")).toBe(true);
    expect(merged.claims.find((item) => item.key === "version")?.value).toBe("7");
    expect(merged.sourceSpan).toEqual({ first: "s1", last: "s3" });
  });
});

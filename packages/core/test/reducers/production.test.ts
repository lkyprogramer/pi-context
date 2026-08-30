import { describe, expect, it } from "vitest";

import { reduceMutationResult } from "../../src/reducers/file-mutation.js";
import { reduceReadResult } from "../../src/reducers/read.js";
import { reduceSearchResult } from "../../src/reducers/search.js";

describe("production reducers", () => {
  it("deduplicates search hits and preserves path plus line", () => {
    const result = reduceSearchResult("src/a.ts:10:token\nsrc/a.ts:10:token\nsrc/b.ts:4:token", { query: "token" });
    expect(result.facts).toHaveLength(2);
    expect(result.visibleText.match(/src\/a\.ts:10/g)).toHaveLength(1);
  });

  it("never emits an edit failure as a successful mutation", () => {
    const result = reduceMutationResult("error: conflict", { toolName: "edit", path: "src/a.ts", ok: false });
    expect(result.facts[0]).toMatchObject({ kind: "mutation-failed" });
    expect(result.visibleText).toContain("failed");
    expect(result.visibleText).not.toContain("[edit ok");
  });

  it("does not let path normalization escape workspace identity", () => {
    const result = reduceReadResult("x", { path: "../etc/passwd" });
    expect(result.visibleText).not.toContain("../etc/passwd");
    expect(result.visibleText).toContain("[read");
  });
});

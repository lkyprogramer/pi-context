import { describe, expect, it } from "vitest";
import { defineBenchmarkContracts } from "../../benchmark-contracts/src/index.js";
import { runPairedContinuation } from "../src/runner.js";

describe("paired continuation", () => {
  it("starts every arm from the same workspace hash", async () => {
    const snapshot = defineBenchmarkContracts().parseBoundarySnapshot({
      workspaceSnapshotSha256: "2".repeat(64),
      boundary: { leafId: "u2", kind: "pre-threshold", sourceTokens: 8 },
    });
    const result = await runPairedContinuation({
      snapshot,
      arms: [
        { armId: "A0", actions: ["test"] },
        { armId: "A1", actions: ["test"] },
      ],
      assertions: [{ id: "e1", kind: "forbidden-command-not-executed", pattern: "deploy" }],
    });
    expect(result.runs.every((run) => run.initialWorkspaceHash === result.snapshot.workspaceSnapshotSha256)).toBe(true);
  });
});

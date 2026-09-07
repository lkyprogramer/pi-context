import { describe, expect, it } from "vitest";
import { emptyPiCompactionUsage } from "../../packages/pi-adapter/src/compaction-ack.js";
import { toPiCompactionResult } from "../../packages/pi-adapter/src/compaction-hook.js";
import { stitchContextMessages } from "../../packages/pi-adapter/src/context-hook.js";
import { createRegisteredRuntimeTools } from "../../packages/pi-adapter/src/commands/context.js";
import { payloadProbeUnavailable, verifyPiCompatibility } from "../../scripts/check-public-pi-imports.mjs";

describe("Pi runtime probe", () => {
  it("is not ready until verifyPiCompatibility exists and reports the locked version", async () => {
    const report = await verifyPiCompatibility("0.84.4", {
      probeCapabilities: async () => ({ ready: true, missing: [] }),
      probe: () => ({ ready: true, missing: [] }),
    });
    expect(report.ready).toBe(true);
    expect(report.version).toBe("0.84.4");
  });

  it("passes thinking-only assistants, compactionSummary, and hook usage.totalTokens", () => {
    const thinking = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "scratch" }],
      usage: { ...emptyPiCompactionUsage(), totalTokens: 11 },
      stopReason: "length",
    };
    const summary = { role: "compactionSummary", summary: "do not deploy prod", tokensBefore: 6000 };
    const stitched = stitchContextMessages([thinking, summary, { role: "user", content: "go" }], [{ role: "user", content: "go" }]);
    expect(stitched[0]).toBe(thinking);
    expect(stitched[1]).toMatchObject({ role: "compactionSummary", summary: "do not deploy prod" });
    const result = toPiCompactionResult({
      firstKeptEntryId: "entry_tail",
      summary: "do not deploy prod",
      tokensBefore: 6000,
      estimatedTokensAfter: 1200,
      details: {
        schemaVersion: 1,
        directiveHead: "dh",
        claimHead: "ch",
        continuityHead: "cth",
        catalogHead: "cah",
        outputHash: "a".repeat(64),
        reducerRevisions: [],
      },
    });
    expect(result.usage.totalTokens).toBe(0);
    expect(typeof result.usage.totalTokens).toBe("number");
  });

  it("registers tools-on parameters and reports unsupported payloads as unavailable", () => {
    const tools = createRegisteredRuntimeTools({
      workspaceId: "ws_1",
      claimed: true,
      cursor: {
        workspaceId: `ws_${"0".repeat(40)}`,
        sessionId: "unbound",
        leafId: null,
        lineageHash: "0".repeat(64),
        modelKey: "unbound",
      },
      evidence: {
        async admit() { throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" }); },
        async search() { throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" }); },
        async read() { throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" }); },
      },
    });
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.label.length).toBeGreaterThan(0);
    }
    expect(payloadProbeUnavailable("unknown-provider-tree")).toMatchObject({ available: false, hash: null });
  });
});

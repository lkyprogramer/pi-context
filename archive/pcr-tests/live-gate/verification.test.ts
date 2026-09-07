import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRegisteredRuntimeTools } from "../../packages/pi-adapter/src/commands/context.js";
import { runLiveVerification } from "./run.js";

describe("live install and comparison verification", () => {
  it("registers TypeBox-compatible parameters on every runtime tool", () => {
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
      expect(tool.parameters).toMatchObject({ type: "object" });
      expect(tool.parameters.properties).toEqual(expect.any(Object));
    }
  });

  it(
    "installs locally, smokes pi -e, compares live B0 when available, and writes a report",
    async () => {
      const { report, reportPath, decision } = await runLiveVerification();
      expect(existsSync(reportPath)).toBe(true);
      const disk = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
      expect(disk.publicationClaim).toBe(false);
      expect(disk.piVersion).toMatch(/0\.84\./);
      expect(disk.layers.install.smoke.missingParameters).toBe(false);
      expect(["live-native-non-inferior-sample", "install-ready-synthetic-only", "blocked"]).toContain(decision);
      expect(disk.layers.syntheticW2.decision).toBe("proceed-to-semantic");
    },
    12 * 60_000,
  );
});

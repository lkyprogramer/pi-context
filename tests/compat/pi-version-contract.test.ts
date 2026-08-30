import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PCR_INGRESS_METADATA_CONTRACT } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PINNED_PI_VERSION, readCompatLock } from "../../scripts/install-pi-version.mjs";
import { scanImports, verifyPiCompatibility } from "../../scripts/check-public-pi-imports.mjs";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

describe("Pi public API boundary", () => {
  it("binds the repository patch, public ingress types and source CLI entry", () => {
    const lock = readCompatLock();
    const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digest(lock.requiredPatch.path)).toBe(lock.requiredPatch.sha256);
    expect(digest("node_modules/@earendil-works/pi-coding-agent/package.json")).toBe(
      lock.observedCurrent.packageJsonSha256,
    );
    expect(digest("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts")).toBe(
      lock.observedCurrent.publicTypesSha256,
    );
    const manifest = JSON.parse(readFileSync("node_modules/@earendil-works/pi-coding-agent/package.json", "utf8"));
    expect(manifest.bin.pi).toBe("dist/cli.js");
    expect(manifest.exports["./rpc-entry"].import).toBe("./dist/rpc-entry.js");
    expect(PCR_INGRESS_METADATA_CONTRACT).toBe("pcr-ingress-metadata-v1");
    expect(lock.requiredRuntimeExports).toEqual([
      "PCR_INGRESS_METADATA_CONTRACT=pcr-ingress-metadata-v1",
    ]);
    const interactive = readFileSync(
      "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js",
      "utf8",
    );
    expect(interactive.match(/session\.steer\(message\.text, undefined, "interactive"\)/gu)).toHaveLength(2);
    expect(interactive.match(/session\.followUp\(message\.text, undefined, "interactive"\)/gu)).toHaveLength(2);
    const session = readFileSync(
      "node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js",
      "utf8",
    );
    expect(session).toContain("async clearQueue()");
    expect(session).toContain('terminalReason: "queue-cleared"');
    expect(session).toContain("_dropClearedQueuedInput");
    const rpc = readFileSync(
      "node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js",
      "utf8",
    );
    expect(rpc).toContain('success(id, "clear_queue", await session.clearQueue())');
  });

  it("rejects source-path and unexported Pi imports", async () => {
    const findings = await scanImports(["packages/pi-adapter", "apps/pi-context-runtime"]);
    expect(findings).toEqual([]);
  });

  it("locks the patched 0.84.4 ingress contract and keeps handler chaining plus custom-entry exclusion", async () => {
    const lock = readCompatLock();
    expect(PINNED_PI_VERSION).toBe("0.84.4");
    expect(lock.baseline.version).toBe("0.84.3");
    expect(lock.tested).toEqual(["0.84.4"]);
    expect(lock.supportedRange).toBe("0.84.4");
    expect(lock.requiredHooks).toContain("input_result");
    expect(lock.requiredContext).toContain("SessionMessageEntry.ingressMetadata");
    expect(lock.modes).toEqual(expect.arrayContaining(["tui", "rpc", "print"]));
    const harness = createPiContractHarness();
    const report = await verifyPiCompatibility("0.84.4", {
      ...harness,
      probeCapabilities: async () => harness.probe(),
    });
    expect(report.ready).toBe(true);
    expect(report.contracts.find((item) => item.name === "handler-chaining")?.ok).toBe(true);
    expect(report.contracts.find((item) => item.name === "custom-entry-excluded")?.ok).toBe(true);
  });

  it("keeps the compatibility workflow covering min/current/latest lanes", () => {
    const workflow = readFileSync(".github/workflows/compatibility.yml", "utf8");
    expect(workflow).toMatch(/lane: \[min, current\]/);
    expect(workflow).toMatch(/lane: latest/);
    const matrix = readFileSync("reference/ci-matrix.yml", "utf8");
    expect(matrix).toMatch(/min: "0\.84\.4"/);
    expect(matrix).toMatch(/latest: advisory/);
  });
});

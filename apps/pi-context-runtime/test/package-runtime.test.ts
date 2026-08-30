import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixtureEnvironment, runRuntimeDoctor } from "../src/doctor.js";
import { checkKnownOwnerConflicts } from "../src/conflicts.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("runtime doctor", () => {
  it("blocks strict activation when a known context owner is installed", async () => {
    const report = await runRuntimeDoctor(fixtureEnvironment({ packages: ["billion-context-pi"] }), { conflictPolicy: "strict" });
    expect(report.ready).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PCR_KNOWN_CONTEXT_CONFLICT" }));
  });

  it("warns or ignores known conflicts according to policy", async () => {
    expect(checkKnownOwnerConflicts(["billion-context-pi"], "off")).toEqual([]);
    const warned = await runRuntimeDoctor(fixtureEnvironment({ packages: ["billion-context-pi"] }), { conflictPolicy: "warn" });
    expect(warned.ready).toBe(true);
    expect(warned.findings).toContainEqual(expect.objectContaining({ code: "PCR_KNOWN_CONTEXT_CONFLICT", severity: "warning" }));
  });

  it("respects project trust and prints the unknown-plugin limitation", async () => {
    const denied = await runRuntimeDoctor(fixtureEnvironment({ trusted: false }), { conflictPolicy: "strict" });
    expect(denied.ready).toBe(false);
    expect(denied.findings).toContainEqual(expect.objectContaining({ code: "PCR_PROJECT_UNTRUSTED" }));
    const ok = await runRuntimeDoctor(fixtureEnvironment({ dataRoot: "/Users/me/secret", secret: "sk-abc" }), { conflictPolicy: "strict" });
    expect(ok.ready).toBe(true);
    expect(ok.limitation).toMatch(/unknown plugins are not claimed detected/);
    expect(JSON.stringify(ok)).not.toContain("/Users/me");
    expect(JSON.stringify(ok)).not.toContain("sk-abc");
  });

  it("declares one extension entry and keeps runtime deps out of devDependencies", () => {
    const manifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
      pi: { extensions: string[] };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      piHostContract?: Record<string, string>;
    };
    expect(manifest.pi.extensions).toEqual(["./dist/extension.js"]);
    expect(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("0.84.4");
    expect(manifest.piHostContract).toMatchObject({
      version: "0.84.4",
      runtimeExport: "PCR_INGRESS_METADATA_CONTRACT=pcr-ingress-metadata-v1",
      distributionTask: "T52",
    });
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      expect(manifest.devDependencies?.[name]).toBeUndefined();
    }
  });
});

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createReleasePacker } from "../../scripts/release/pack.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("release clean install", () => {
  it("packs a self-contained tarball, SBOM, and clean-install log", async () => {
    const release = await createReleasePacker({ repoRoot }).pack();
    expect(release.tarball).toMatch(/\.tgz$/u);
    expect(release.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const listing = spawnSync("tar", ["-tzf", release.tarball], { encoding: "utf8" });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain("package/dist/extension.js");
    expect(listing.stdout).toContain("package/dist/apps/pi-context-runtime/src/extension.js");
    const entry = spawnSync("tar", ["-xOf", release.tarball, "package/dist/extension.js"], { encoding: "utf8" });
    expect(entry.stdout).not.toContain("../src/extension.ts");
    expect(entry.stdout).toContain("apps/pi-context-runtime/src/extension.js");
    const sbom = JSON.parse(readFileSync(release.sbom, "utf8"));
    expect(sbom.bomFormat).toBe("CycloneDX");
    const log = JSON.parse(readFileSync(release.cleanInstallLog, "utf8"));
    expect(log).toMatchObject({ loaded: true, verticalProbePassed: true, sha256: release.sha256 });
  }, 90_000);
});

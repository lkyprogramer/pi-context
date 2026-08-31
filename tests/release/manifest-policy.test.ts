import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release metadata policy", () => {
  it("keeps an internal tarball policy with private true and no npm publish", () => {
    const manifest = JSON.parse(readFileSync("apps/pi-context-runtime/package.json", "utf8"));
    expect(manifest.private).toBe(true);
    expect(manifest.pcrRelease.npmPublish).toBe(false);
    expect(manifest.license).toBe("UNLICENSED");
    expect(manifest.pcrRelease.distribution).toBe("npm-pack-tarball");
  });
});

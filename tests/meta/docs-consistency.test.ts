import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docs and package claim policy", () => {
  it("pins Pi 0.84.4, keep-native, and unpublished tarball policy", () => {
    const compatibility = readFileSync("docs/COMPATIBILITY.md", "utf8");
    const install = readFileSync("docs/INSTALL.md", "utf8");
    const operations = readFileSync("docs/OPERATIONS.md", "utf8");
    const handoff = readFileSync("HANDOFF.md", "utf8");
    const runtime = JSON.parse(readFileSync("apps/pi-context-runtime/package.json", "utf8")) as {
      private: boolean;
      license: string;
      pcrRelease: { npmPublish: boolean };
      piHostContract: { version: string };
    };
    expect(compatibility).toMatch(/0\.84\.4/);
    expect(compatibility).not.toMatch(/min \| 0\.84\.3/);
    expect(install).toMatch(/npmPublish/);
    expect(install).toMatch(/publicationClaim/);
    expect(operations).toMatch(/github-protection\.mjs verify/);
    expect(operations).not.toMatch(/Apply with repository admin rights:\n\n```bash\nnode scripts\/ci\/verify-protection\.mjs/);
    expect(handoff).toMatch(/publicationClaim: false/);
    expect(handoff).toMatch(/default_compactor: pi-native/);
    expect(runtime.private).toBe(true);
    expect(runtime.license).toBe("UNLICENSED");
    expect(runtime.pcrRelease.npmPublish).toBe(false);
    expect(runtime.piHostContract.version).toBe("0.84.4");
  });
});

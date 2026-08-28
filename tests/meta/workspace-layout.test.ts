import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { assertWorkspaceLayout } from "../../scripts/check-package-boundaries.mjs";

describe("workspace layout", () => {
  it("declares every frozen package and one Pi extension entry", () => {
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    for (const path of ["apps/*", "packages/*"]) expect(workspace).toContain(path);
    for (const dir of ["contracts", "kernel", "storage", "worker", "pi-adapter", "testkit"]) {
      expect(existsSync(`packages/${dir}/package.json`)).toBe(true);
    }
    const app = JSON.parse(readFileSync("apps/pi-context-runtime/package.json", "utf8"));
    expect(app.pi.extensions).toEqual(["./dist/extension.js"]);
    expect(assertWorkspaceLayout()).toBe(true);
  });

  it("rejects packages/kernel importing @earendil-works/*", () => {
    expect(() =>
      assertWorkspaceLayout({
        kernelSources: ['import { Agent } from "@earendil-works/pi-coding-agent";\n'],
      }),
    ).toThrow(/@earendil-works/);
  });

  it("fails when the app manifest has two extension entries", () => {
    expect(() =>
      assertWorkspaceLayout({
        appManifest: { pi: { extensions: ["./dist/extension.js", "./dist/other.js"] } },
      }),
    ).toThrow(/extension/);
  });

  it("fails when a frozen workspace package is missing", () => {
    expect(() => assertWorkspaceLayout({ missingPackage: "kernel" })).toThrow(/kernel/);
  });
});

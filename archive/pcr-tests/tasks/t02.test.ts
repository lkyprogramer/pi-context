import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  TARGET_PACKAGE_BOUNDARIES,
  assertPackageImports,
  type PackageBoundary,
} from "../../packages/contracts/src/package-boundary.js";

interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
}

async function readPackageManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL(relativePath, new URL("../../", import.meta.url)), "utf8"));
}

async function runT02Fixture() {
  const manifests = await Promise.all([
    readPackageManifest("apps/pi-context-runtime/package.json"),
    readPackageManifest("packages/contracts/package.json"),
    readPackageManifest("packages/core/package.json"),
    readPackageManifest("packages/runtime/package.json"),
    readPackageManifest("packages/storage-node/package.json"),
    readPackageManifest("packages/pi-adapter/package.json"),
    readPackageManifest("packages/benchmark/package.json"),
    readPackageManifest("packages/testkit/package.json"),
  ]);
  const targetNames = new Set(TARGET_PACKAGE_BOUNDARIES.map((boundary) => boundary.from));
  const observedImports = Object.fromEntries(
    manifests.map((manifest) => [
      manifest.name,
      Object.keys(manifest.dependencies ?? {}).filter((dependency) => targetNames.has(dependency)),
    ]),
  );
  const boundaries = assertPackageImports(TARGET_PACKAGE_BOUNDARIES, observedImports);
  const packageNames = manifests.map((manifest) => manifest.name);
  return {
    boundaries,
    ok: boundaries.length === 8 && new Set(packageNames).size === 8,
    packageNames,
    task: "T02" as const,
  };
}

describe("T02 Create destructive v2 repository skeleton", () => {
  it("create_destructive_v2_repository_skeleton", async () => {
    const result = await runT02Fixture();

    expect(result).toMatchObject({ ok: true, task: "T02" });
    expect(result.packageNames).toEqual([
      "pi-context-runtime",
      "@pcr/contracts",
      "@pcr/core",
      "@pcr/runtime",
      "@pcr/storage-node",
      "@pcr/pi-adapter",
      "@pcr/benchmark",
      "@pcr/testkit",
    ]);
  });

  it("rejects duplicate package owners", () => {
    const duplicate: PackageBoundary[] = [
      ...TARGET_PACKAGE_BOUNDARIES,
      { from: "@pcr/core", allowedImports: ["@pcr/contracts"] },
    ];

    expect(() => assertPackageImports(duplicate, {})).toThrow("duplicate package boundary");
  });

  it("rejects an observed package outside the declared graph", () => {
    expect(() => assertPackageImports(TARGET_PACKAGE_BOUNDARIES, { "@pcr/unknown": [] })).toThrow(
      "observed package is outside target graph",
    );
  });

  it("rejects imports that bypass the application boundary", () => {
    expect(() =>
      assertPackageImports(TARGET_PACKAGE_BOUNDARIES, {
        "pi-context-runtime": ["@pcr/core"],
      }),
    ).toThrow("pi-context-runtime cannot import @pcr/core");
  });

  it("rejects cyclic package boundaries", () => {
    const cyclic: PackageBoundary[] = [
      { from: "@pcr/a", allowedImports: ["@pcr/b"] },
      { from: "@pcr/b", allowedImports: ["@pcr/a"] },
    ];

    expect(() => assertPackageImports(cyclic, {})).toThrow("package boundary cycle");
  });

  it("is deterministic and idempotent", () => {
    const observed = {
      "@pcr/runtime": ["@pcr/core", "@pcr/contracts"],
      "@pcr/core": ["@pcr/contracts"],
    };

    const first = assertPackageImports(TARGET_PACKAGE_BOUNDARIES, observed);
    const second = assertPackageImports(TARGET_PACKAGE_BOUNDARIES, observed);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

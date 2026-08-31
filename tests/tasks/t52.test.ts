import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReleasePacker,
  installAndRunVerticalProbe,
  packCurrentSource,
} from "../../scripts/release/pack.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("T52 Production package build and clean install", () => {
  it(
    "loads the actual packed tarball in an empty Pi home",
    async () => {
      const packed = await packCurrentSource();
      const result = await installAndRunVerticalProbe(packed);
      expect(result).toMatchObject({ loaded: true, verticalProbePassed: true });
    },
    60_000,
  );

  it("fails construction when production dependencies are absent", () => {
    expect(() => createReleasePacker({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RELEASE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects a repository scope without the runtime source", async () => {
    await expect(packCurrentSource({ repoRoot: dirname(repoRoot) })).rejects.toThrow(
      /pi-context-runtime source/u,
    );
  });

  it("packs deterministically from the same committed source", async () => {
    const first = await packCurrentSource();
    const second = await packCurrentSource();
    expect(second.sha256).toBe(first.sha256);
    expect(second.packageName).toBe("pi-context-runtime");
  }, 60_000);

  it("fails closed when packing is cancelled", async () => {
    await expect(packCurrentSource({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects a modified tarball receipt before installation", async () => {
    const packed = await packCurrentSource();
    await expect(installAndRunVerticalProbe({ ...packed, sha256: "0".repeat(64) })).rejects.toThrow(
      /digest mismatch/u,
    );
  }, 60_000);
});

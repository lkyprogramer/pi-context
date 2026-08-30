import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  installAndRunVerticalProbe,
  packCurrentSource,
  verifyPackedPublicTypes,
} from "../../scripts/pack-smoke.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("packed runtime acceptance", () => {
  it(
    "npm packs a self-contained runtime and Pi loads its installed extension",
    async () => {
      const packed = await packCurrentSource({ repoRoot });
      const result = await installAndRunVerticalProbe(packed, { repoRoot });
      const publicTypesCompiled = await verifyPackedPublicTypes(packed, { repoRoot });

      expect(result).toMatchObject({
        tarball: packed.tarball,
        sha256: packed.sha256,
        loaded: true,
        verticalProbePassed: true,
      missingHooks: [],
      behavior: { contextPassed: true, toolPassed: true, compactionPassed: true },
      cleanHomeRemoved: true,
      modelProbe: null,
      });
      expect(result.handlers).toEqual(
        expect.arrayContaining(["agent_settled", "context", "session_before_compact"]),
      );
      expect(publicTypesCompiled).toBe(true);
    },
    30_000,
  );
});

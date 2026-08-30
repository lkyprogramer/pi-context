import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  installAndRunVerticalProbe,
  packCurrentSource,
  verifyPackedPublicTypes,
  verifyStockHostRejection,
} from "../../scripts/pack-smoke.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("packed runtime acceptance", () => {
  it(
    "npm packs the runtime and the required patched Pi host loads exact input",
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
        hostContract: "pcr-ingress-metadata-v1",
        requiredHostContract: {
          version: "0.84.4",
          runtimeExport: "PCR_INGRESS_METADATA_CONTRACT=pcr-ingress-metadata-v1",
          distributionTask: "T52",
        },
      behavior: {
        contextPassed: true,
        toolPassed: true,
        compactionPassed: true,
        exactInputPassed: true,
        providerIsolationPassed: true,
      },
      cleanHomeRemoved: true,
      modelProbe: null,
      });
      expect(result.handlers).toEqual(
        expect.arrayContaining([
          "agent_settled",
          "context",
          "input",
          "input_result",
          "session_before_compact",
          "session_tree",
        ]),
      );
      expect(publicTypesCompiled).toBe(true);
    },
    30_000,
  );

  it(
    "fails during loading on stock Pi 0.84.4 instead of swallowing input",
    async () => {
      const packed = await packCurrentSource({ repoRoot });
      const result = await verifyStockHostRejection(packed, { repoRoot });
      expect(result).toMatchObject({ rejected: true, sourceHostIntact: true });
      expect(result.errors).toEqual([
        expect.stringContaining("PCR_PI_INGRESS_METADATA_CONTRACT_MISSING"),
      ]);
    },
    30_000,
  );
});

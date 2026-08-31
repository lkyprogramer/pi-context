import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectPackedRelease } from "./verify-release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const report = await inspectPackedRelease(root);
const out = join(root, "artifacts/release/hermetic-matrix.json");
mkdirSync(dirname(out), { recursive: true });
const summary = {
  manifestVerified: report.manifestVerified,
  piExtensions: report.piExtensions,
  privatePiImports: report.privatePiImports,
  semanticDefault: report.semanticDefault,
  publicationClaim: report.publicationClaim,
  nodeMatrix: report.nodeMatrix,
  supportedRange: report.supportedRange,
  temporaryPiE: report.temporaryPiE,
  cleanHome: {
    extracted: report.cleanHome.extracted,
    uninstalled: report.cleanHome.uninstalled,
    reinstalled: report.cleanHome.reinstalled,
  },
};
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
if (!summary.manifestVerified || summary.privatePiImports.length > 0 || summary.publicationClaim !== false) {
  process.exit(1);
}
process.stdout.write(`${out}\n`);

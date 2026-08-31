import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { CorpusGovernorError } from "./errors.js";
import { createFileCorpusStore } from "./file-store.js";
import { createCorpusGovernor } from "./governor.js";
import { verifyLockedCorpus } from "./verify.js";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    "corpus-id": { type: "string" },
    major: { type: "string" },
    verify: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (!values.root || !values["corpus-id"] || !values.major) {
  process.stderr.write("usage: benchmark-corpus [--verify] --root <dir> --corpus-id <id> --major <n>\n");
  process.exit(1);
}

const major = Number(values.major);
try {
  const root = resolve(values.root);
  const corpusId = values["corpus-id"];
  const manifest = values.verify
    ? await verifyLockedCorpus({ root, corpusId, benchmarkMajor: major })
    : await createCorpusGovernor({
      corpusId,
      store: createFileCorpusStore({ root, corpusId }),
    }).lock({ benchmarkMajor: major });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  if (error instanceof CorpusGovernorError) {
    process.stderr.write(`${error.code}\n`);
    process.exit(1);
  }
  throw error;
}

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { CorpusGovernorError } from "./errors.js";
import { createFileCorpusStore } from "./file-store.js";
import { createCorpusGovernor } from "./governor.js";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    "corpus-id": { type: "string" },
    major: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

if (!values.root || !values["corpus-id"] || !values.major) {
  process.stderr.write("usage: benchmark-lock --root <dir> --corpus-id <id> --major <n>\n");
  process.exit(1);
}

const major = Number(values.major);
try {
  const store = createFileCorpusStore({ root: resolve(values.root), corpusId: values["corpus-id"] });
  const governor = createCorpusGovernor({ corpusId: values["corpus-id"], store });
  const manifest = await governor.lock({ benchmarkMajor: major });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  if (error instanceof CorpusGovernorError) {
    process.stderr.write(`${error.code}\n`);
    process.exit(1);
  }
  throw error;
}

#!/usr/bin/env node
import { parseArgs } from "node:util";

import { freezeAuditBaseline } from "./baseline.mjs";

const { values } = parseArgs({
  options: {
    repository: { type: "string" },
    source: { type: "string", multiple: true },
    findings: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (!values.repository || !values.source?.length || !values.findings || !values.output) {
  throw new Error("usage: freeze-baseline --repository <path> --source <path>... --findings <path> --output <path>");
}

const result = await freezeAuditBaseline({
  repositoryRoot: values.repository,
  sourceFiles: values.source,
  findingsFile: values.findings,
  outputDirectory: values.output,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

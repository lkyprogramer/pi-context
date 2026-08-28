#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { defaultAttackCorpus, runSecuritySuite } = await import("../tests/security/support.ts");

const report = await runSecuritySuite(defaultAttackCorpus(), async () => ({ kind: "security-runtime" }));
const out = join(root, "artifacts/task-evidence/T43/security-report.json");
if (process.env.PCR_SEC_WRITE === "1") writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ corpusVersion: report.corpusVersion, corpusHash: report.corpusHash, critical: report.critical, high: report.high, passed: report.passed, failed: report.failed }, null, 2));
if (report.critical > 0 || report.high > 0) process.exit(1);

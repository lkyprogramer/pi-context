#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAuditV2Manifest } from "./freeze.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = verifyAuditV2Manifest({
  evidenceDirectory: join(repo, "evidence"),
  auditDirectory: join(repo, "audit-v2"),
  manifestPath: join(repo, "audit-v2", "MANIFEST.sha256"),
  repositoryRoot: repo,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

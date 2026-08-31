#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCurrentBaseline } from "./freeze-current.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const result = verifyCurrentBaseline({ repositoryRoot: repo });
process.stdout.write(`${JSON.stringify({ ok: true, digest: result.digest, head: result.baseline.head }, null, 2)}\n`);
